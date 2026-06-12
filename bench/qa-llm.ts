/**
 * LLM-judged QA evaluation of compression quality. Plants 12 decision facts
 * with unique answer tokens into each dataset, compresses, then asks a real
 * model to answer each question given only a candidate context. Scoring is
 * objective: the reply must contain the unique answer token.
 *
 * Requires OPENAI_API_KEY in .env (never committed). Run:
 *   npm run bench:llm
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compress, injectContext, recall, estimateTokens } from './harness-imports.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODEL = process.env.QA_MODEL ?? 'gpt-4o-mini'

// ── .env loading (no dependency) ──────────────────────────────────────────────
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

// curl instead of fetch: respects system proxy configuration everywhere
function chat(system: string, user: string): string {
  const body = JSON.stringify({
    model: MODEL,
    temperature: 0,
    max_tokens: 60,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  })
  const r = spawnSync(
    'curl',
    [
      '-s', '--max-time', '60',
      'https://api.openai.com/v1/chat/completions',
      '-H', `Authorization: Bearer ${API_KEY}`,
      '-H', 'Content-Type: application/json',
      '-d', body,
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
  if (r.status !== 0) throw new Error(`curl failed: ${r.stderr}`)
  const parsed = JSON.parse(r.stdout) as {
    error?: { message: string }
    choices?: { message: { content: string } }[]
  }
  if (parsed.error) throw new Error(`API error: ${parsed.error.message}`)
  return parsed.choices?.[0]?.message.content ?? ''
}

// ── deterministic PRNG + planted facts (same seeds as bench/run.ts) ──────────
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Fact {
  sentence: string
  question: string
  answer: string
}

const FACTS: Fact[] = [
  { sentence: 'After the outage review we decided to name the rollout plan BLUEFINCH going forward.', question: 'What did we decide to name the rollout plan?', answer: 'BLUEFINCH' },
  { sentence: 'The team committed to capping the retry budget at COPPERFIELD9 requests per minute.', question: 'What retry budget cap did the team commit to?', answer: 'COPPERFIELD9' },
  { sentence: 'We resolved that the encryption rollout would use the MARIGOLD7 cipher suite only.', question: 'Which cipher suite did we resolve to use for encryption?', answer: 'MARIGOLD7' },
  { sentence: 'Management agreed the datacenter migration deadline is codenamed SILVERPINE now.', question: 'What is the datacenter migration deadline codenamed?', answer: 'SILVERPINE' },
  { sentence: 'The working group decided the audit trail retention period equals NIGHTJAR4 days exactly.', question: 'What audit trail retention period was decided?', answer: 'NIGHTJAR4' },
  { sentence: 'Engineering concluded the cache invalidation strategy should be called THORNBERRY.', question: 'What is the cache invalidation strategy called?', answer: 'THORNBERRY' },
  { sentence: 'We committed to promoting the staging cluster under the label FOXGLOVE2 next sprint.', question: 'Under what label did we commit to promoting the staging cluster?', answer: 'FOXGLOVE2' },
  { sentence: 'The board resolved that the acquisition escrow account uses identifier LANTERN88.', question: 'What identifier does the acquisition escrow account use?', answer: 'LANTERN88' },
  { sentence: 'After long debate we decided the telemetry sampling rate stays at WOLFRAM3 percent.', question: 'What telemetry sampling rate did we decide on?', answer: 'WOLFRAM3' },
  { sentence: 'The committee agreed the incident severity rubric is now versioned as HOLLYHOCK1.', question: 'What version is the incident severity rubric?', answer: 'HOLLYHOCK1' },
  { sentence: 'Operations decided the failover region pairing will be referred to as IRONWOOD5.', question: 'What is the failover region pairing referred to as?', answer: 'IRONWOOD5' },
  { sentence: 'We concluded that the customer export pipeline budget is fixed at PIMPERNEL6 dollars.', question: 'What is the customer export pipeline budget fixed at?', answer: 'PIMPERNEL6' },
]

function plantFacts(text: string, rnd: () => number): string {
  const paras = text.split(/\n\n+/)
  const out = [...paras]
  for (const f of FACTS) {
    const pos = 1 + Math.floor(rnd() * (out.length - 2))
    out.splice(pos, 0, f.sentence)
  }
  return out.join('\n\n')
}

// ── datasets ──────────────────────────────────────────────────────────────────
function loadDatasets(): { name: string; text: string }[] {
  const norm = (s: string) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const sets: { name: string; text: string }[] = []
  const conv = join(HERE, '..', 'test-conversation.txt')
  if (existsSync(conv)) sets.push({ name: 'conversation', text: norm(readFileSync(conv, 'utf8')) })
  for (const [name, file] of [
    ['novel (P&P)', 'pride-and-prejudice.txt'],
    ['science (Origin)', 'origin-of-species.txt'],
  ] as const) {
    const p = join(HERE, 'data', file)
    if (existsSync(p)) sets.push({ name, text: norm(readFileSync(p, 'utf8')) })
  }
  return sets
}

// ── evaluation ────────────────────────────────────────────────────────────────
const SYSTEM =
  'Answer the question using ONLY the provided context. ' +
  'Reply with the exact answer value. If the context does not contain the answer, reply UNKNOWN.'

function ask(context: string, question: string): string {
  return chat(SYSTEM, `Context:\n${context}\n\nQuestion: ${question}`)
}

interface Condition {
  name: string
  build: (r: ReturnType<typeof compress>, planted: string, q: Fact) => string
}

const CONDITIONS: Condition[] = [
  { name: 'no context', build: () => '(no context provided)' },
  {
    name: 'zettel budget-300 (aaak)',
    build: (r) => injectContext(r, { maxTokenBudget: 300 }),
  },
  {
    name: 'zettel budget-300 (markdown)',
    build: (r) => injectContext(r, { maxTokenBudget: 300, format: 'markdown' }),
  },
  {
    name: 'zettel inject top-10 (markdown)',
    build: (r) => injectContext(r, { maxZettels: 10, format: 'markdown' }),
  },
  {
    name: 'zettel recall top-5',
    build: (r, _planted, q) => recall(r, q.question, { topK: 5 }).map((z) => z.quote).join('\n'),
  },
  {
    name: 'first 300 tokens',
    build: (_r, planted) => planted.split(/\s+/).slice(0, 230).join(' '),
  },
]

console.log(`# LLM QA evaluation — model: ${MODEL}\n`)
console.log('| dataset | condition | context tokens (avg) | QA accuracy |')
console.log('|---|---|---|---|')

let totalCalls = 0
for (const d of loadDatasets()) {
  const rnd = mulberry32(0x5eed)
  const planted = plantFacts(d.text, rnd)
  const r = compress(planted)

  for (const cond of CONDITIONS) {
    let correct = 0
    let ctxTokens = 0
    for (const f of FACTS) {
      const context = cond.build(r, planted, f)
      ctxTokens += estimateTokens(context)
      const reply = ask(context, f.question)
      totalCalls++
      if (reply.includes(f.answer)) correct++
    }
    const acc = ((correct / FACTS.length) * 100).toFixed(0)
    console.log(
      `| ${d.name} | ${cond.name} | ${Math.round(ctxTokens / FACTS.length)} | ${acc}% (${correct}/${FACTS.length}) |`,
    )
  }
}

console.log(`\n${totalCalls} model calls — done.`)
