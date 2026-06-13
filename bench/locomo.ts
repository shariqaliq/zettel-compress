/**
 * LoCoMo-10 evaluation (Maharana et al., ACL 2024 — snap-research/locomo).
 * Very-long-term conversational QA: 10 multi-session conversations,
 * 1,986 questions in 5 categories (1 multi-hop, 2 temporal, 3 open-domain,
 * 4 single-hop, 5 adversarial/unanswerable).
 *
 * Protocol: each conversation is compressed once; for every question the
 * model (default gpt-4o-mini) answers from recall(question) top-10 zettel
 * quotes only. Scoring: token-level F1 + normalized substring accuracy for
 * categories 1–4; abstention ("UNKNOWN") for category 5. A no-context
 * baseline runs on every 5th question.
 *
 * Requires OPENAI_API_KEY in .env. Run: npm run bench:locomo
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compress, recallContext, estimateTokens } from './harness-imports.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODEL = process.env.QA_MODEL ?? 'gpt-4o-mini'
const CONCURRENCY = 4 // ~2k-token contexts against a 200k TPM org limit
const TOPK = 10
const MAX_CONTEXT_TOKENS = 3000

// ── key loading ───────────────────────────────────────────────────────────────
function loadKey(): string {
  const envPath = join(HERE, '..', '.env')
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, 'utf8').match(/^OPENAI_API_KEY=(.+)$/m)
    if (m && m[1]!.trim().length > 0) return m[1]!.trim()
  }
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  console.error('OPENAI_API_KEY missing — put it in .env')
  process.exit(1)
}
const API_KEY = loadKey()

// ── chat via curl (respects system proxy), async with retries ────────────────
function curlChat(system: string, user: string): Promise<string> {
  const body = JSON.stringify({
    model: MODEL,
    temperature: 0,
    max_tokens: 60,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  })
  return new Promise((resolve, reject) => {
    const p = spawn('curl', [
      '-s', '--max-time', '90',
      'https://api.openai.com/v1/chat/completions',
      '-H', `Authorization: Bearer ${API_KEY}`,
      '-H', 'Content-Type: application/json',
      '-d', '@-',
    ])
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`curl exit ${code}: ${err.slice(0, 120)}`))
      try {
        const parsed = JSON.parse(out) as {
          error?: { message: string }
          choices?: { message: { content: string } }[]
        }
        if (parsed.error) return reject(new Error(parsed.error.message.slice(0, 160)))
        resolve(parsed.choices?.[0]?.message.content ?? '')
      } catch {
        reject(new Error(`bad response: ${out.slice(0, 120)}`))
      }
    })
    p.stdin.write(body)
    p.stdin.end()
  })
}

async function chat(system: string, user: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await curlChat(system, user)
    } catch (e) {
      const msg = (e as Error).message
      // TPM windows need a long wait, not a quick retry
      if (/rate limit/i.test(msg)) {
        if (attempt >= 10) throw e
        await new Promise((r) => setTimeout(r, 30_000))
        continue
      }
      if (attempt >= 2) throw e
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let done = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!, i)
      done++
      if (done % 200 === 0) console.error(`  ... ${done}/${items.length}`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// ── scoring (SQuAD-style normalization) ──────────────────────────────────────
function normTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !['a', 'an', 'the'].includes(t))
}

function tokenF1(pred: string, gold: string): number {
  const p = normTokens(pred)
  const g = normTokens(gold)
  if (p.length === 0 || g.length === 0) return p.length === g.length ? 1 : 0
  const gCount = new Map<string, number>()
  for (const t of g) gCount.set(t, (gCount.get(t) ?? 0) + 1)
  let overlap = 0
  for (const t of p) {
    const c = gCount.get(t) ?? 0
    if (c > 0) {
      overlap++
      gCount.set(t, c - 1)
    }
  }
  if (overlap === 0) return 0
  const precision = overlap / p.length
  const recallScore = overlap / g.length
  return (2 * precision * recallScore) / (precision + recallScore)
}

function substringMatch(pred: string, gold: string): boolean {
  return normTokens(pred).join(' ').includes(normTokens(gold).join(' '))
}

// ── dataset ───────────────────────────────────────────────────────────────────
interface Turn {
  speaker: string
  text?: string
  blip_caption?: string
}
interface QA {
  question: string
  answer?: unknown
  adversarial_answer?: string
  category: number
}
interface Sample {
  sample_id: string
  qa: QA[]
  conversation: Record<string, unknown> & { speaker_a: string; speaker_b: string }
}

function conversationText(conv: Sample['conversation']): string {
  const parts: string[] = []
  for (let i = 1; conv[`session_${i}`] !== undefined; i++) {
    const date = String(conv[`session_${i}_date_time`] ?? '')
    for (const turn of conv[`session_${i}`] as Turn[]) {
      let line = `(${date}) ${turn.speaker}: ${turn.text ?? ''}`
      if (turn.blip_caption) line += ` [shares a photo: ${turn.blip_caption}]`
      parts.push(line)
    }
  }
  return parts.join('\n\n')
}

// ── run ───────────────────────────────────────────────────────────────────────
const SYSTEM =
  'You answer questions about a conversation using ONLY the provided memory excerpts. ' +
  'Reply with just the answer, as briefly as possible. ' +
  'If the memory does not contain the answer, reply exactly UNKNOWN.'

const CATEGORY_NAMES: Record<number, string> = {
  1: 'multi-hop',
  2: 'temporal',
  3: 'open-domain',
  4: 'single-hop',
  5: 'adversarial',
}

interface Row {
  category: number
  f1: number
  sub: boolean
  abstained: boolean
  fooled: boolean
  answerInCtx: boolean
  baselineF1?: number
  baselineSub?: boolean
}

async function main(): Promise<void> {
  const data = JSON.parse(
    readFileSync(join(HERE, 'data', 'locomo10.json'), 'utf8'),
  ) as Sample[]

  console.log(`# LoCoMo-10 — model: ${MODEL}, recall top-${TOPK}\n`)

  // compress all conversations up front
  // Pass the first session date so relative expressions within each session
  // have a fallback anchor (the parenthesized timestamps in the text itself
  // are the primary anchor and will override this for most chunks)
  const memories = data.map((s) => {
    const text = conversationText(s.conversation)
    const firstSessionDate = String(s.conversation['session_1_date_time'] ?? '')
    const t0 = performance.now()
    const memory = compress(text, { date: firstSessionDate })
    const ms = performance.now() - t0
    return { s, memory, tokens: estimateTokens(text), ms }
  })
  const totalTokens = memories.reduce((a, m) => a + m.tokens, 0)
  const totalZettels = memories.reduce((a, m) => a + m.memory.zettels.length, 0)
  console.log(
    `compressed ${data.length} conversations: ${totalTokens.toLocaleString()} input tokens → ` +
      `${totalZettels.toLocaleString()} zettels in ${memories.reduce((a, m) => a + m.ms, 0).toFixed(0)}ms total\n`,
  )

  // build the task list
  interface Task {
    qa: QA
    context: string
    ctxTokens: number
    runBaseline: boolean
  }
  const tasks: Task[] = []
  for (const { s, memory } of memories) {
    for (let qi = 0; qi < s.qa.length; qi++) {
      const qa = s.qa[qi]!
      // small-to-big: rank on zettels, return merged source passages
      const context = recallContext(memory, qa.question, {
        topK: TOPK,
        maxTokens: MAX_CONTEXT_TOKENS,
      })
      tasks.push({
        qa,
        context: context.length > 0 ? context : '(no relevant memory found)',
        ctxTokens: estimateTokens(context),
        runBaseline: qi % 5 === 0,
      })
    }
  }
  console.error(`running ${tasks.length} questions (+${tasks.filter((t) => t.runBaseline).length} baseline calls)...`)

  const rows = await pool(tasks, CONCURRENCY, async (t): Promise<Row> => {
    const reply = await chat(SYSTEM, `Memory:\n${t.context}\n\nQuestion: ${t.qa.question}`)
    const gold = t.qa.answer === null || t.qa.answer === undefined ? '' : String(t.qa.answer)
    const row: Row = {
      category: t.qa.category,
      f1: gold ? tokenF1(reply, gold) : 0,
      sub: gold ? substringMatch(reply, gold) : false,
      abstained: /\bunknown\b/i.test(reply),
      fooled:
        t.qa.adversarial_answer !== undefined &&
        substringMatch(reply, t.qa.adversarial_answer),
      answerInCtx: gold ? substringMatch(t.context, gold) : false,
    }
    if (t.runBaseline) {
      const base = await chat(SYSTEM, `Memory:\n(no memory provided)\n\nQuestion: ${t.qa.question}`)
      row.baselineF1 = gold ? tokenF1(base, gold) : 0
      row.baselineSub = gold ? substringMatch(base, gold) : false
    }
    return row
  })

  // aggregate
  const avgCtx = tasks.reduce((a, t) => a + t.ctxTokens, 0) / tasks.length
  console.log(`avg retrieved context: ${avgCtx.toFixed(0)} tokens/question\n`)

  console.log('| category | n | mean F1 | substring acc | answer-in-context |')
  console.log('|---|---|---|---|---|')
  for (const cat of [1, 2, 3, 4]) {
    const rs = rows.filter((r) => r.category === cat)
    const f1 = rs.reduce((a, r) => a + r.f1, 0) / rs.length
    const sub = rs.filter((r) => r.sub).length / rs.length
    const ctx = rs.filter((r) => r.answerInCtx).length / rs.length
    console.log(
      `| ${cat} ${CATEGORY_NAMES[cat]} | ${rs.length} | ${(f1 * 100).toFixed(1)} | ${(sub * 100).toFixed(1)}% | ${(ctx * 100).toFixed(1)}% |`,
    )
  }
  const answerable = rows.filter((r) => r.category !== 5)
  const overallF1 = answerable.reduce((a, r) => a + r.f1, 0) / answerable.length
  const overallSub = answerable.filter((r) => r.sub).length / answerable.length
  console.log(
    `| **1–4 overall** | ${answerable.length} | **${(overallF1 * 100).toFixed(1)}** | **${(overallSub * 100).toFixed(1)}%** | ${((answerable.filter((r) => r.answerInCtx).length / answerable.length) * 100).toFixed(1)}% |`,
  )

  const adv = rows.filter((r) => r.category === 5)
  console.log(
    `\ncategory 5 (adversarial, n=${adv.length}): abstained correctly ${(100 * adv.filter((r) => r.abstained).length / adv.length).toFixed(1)}%, ` +
      `fooled into the trap answer ${(100 * adv.filter((r) => r.fooled).length / adv.length).toFixed(1)}%`,
  )

  const base = rows.filter((r) => r.baselineF1 !== undefined && r.category !== 5)
  if (base.length > 0) {
    const bf1 = base.reduce((a, r) => a + (r.baselineF1 ?? 0), 0) / base.length
    const bsub = base.filter((r) => r.baselineSub).length / base.length
    const sameQs = base
    const mf1 = sameQs.reduce((a, r) => a + r.f1, 0) / sameQs.length
    console.log(
      `\nno-context baseline (same ${base.length} questions): F1 ${(bf1 * 100).toFixed(1)} / substring ${(bsub * 100).toFixed(1)}% ` +
        `vs with-memory F1 ${(mf1 * 100).toFixed(1)} on that subset`,
    )
  }

  console.log(`\n${rows.length + base.length} model calls — done.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
