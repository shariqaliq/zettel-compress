/**
 * Reproducible benchmark harness — every number quoted in the README comes
 * from here. Run with: npm run bench (downloads public-domain datasets on
 * first use). Deterministic: fact placement and baselines use a seeded PRNG.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compress,
  injectContext,
  recall,
  encode,
  decode,
  estimateTokens,
  CompressStream,
  detect,
} from './harness-imports.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, 'data')

// ── deterministic PRNG ────────────────────────────────────────────────────────
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

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

function timeMs(fn: () => unknown, runs = 5): number {
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    fn()
    times.push(performance.now() - t)
  }
  return median(times)
}

// ── datasets ──────────────────────────────────────────────────────────────────
interface Dataset {
  name: string
  text: string
}

function loadDatasets(): Dataset[] {
  const norm = (s: string) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const sets: Dataset[] = []
  const conv = join(HERE, '..', 'test-conversation.txt')
  if (existsSync(conv)) {
    sets.push({ name: 'conversation', text: norm(readFileSync(conv, 'utf8')) })
  }
  for (const [name, file] of [
    ['novel (P&P)', 'pride-and-prejudice.txt'],
    ['science (Origin)', 'origin-of-species.txt'],
  ] as const) {
    const p = join(DATA, file)
    if (existsSync(p)) sets.push({ name, text: norm(readFileSync(p, 'utf8')) })
  }
  return sets
}

// ── planted-fact QA ───────────────────────────────────────────────────────────
// Each fact is a decision sentence with a unique codeword answer. A method
// "answers" the question iff the codeword appears verbatim in its output —
// answer-in-context accuracy, the retrieval component of QA, no model needed.
interface Fact {
  sentence: string
  question: string
  answer: string
}

const FACTS: Fact[] = [
  { sentence: 'After the outage review we decided to name the rollout plan BLUEFINCH going forward.', question: 'what did we decide to name the rollout plan', answer: 'BLUEFINCH' },
  { sentence: 'The team committed to capping the retry budget at COPPERFIELD9 requests per minute.', question: 'what retry budget cap did the team commit to', answer: 'COPPERFIELD9' },
  { sentence: 'We resolved that the encryption rollout would use the MARIGOLD7 cipher suite only.', question: 'which cipher suite did we resolve to use for encryption', answer: 'MARIGOLD7' },
  { sentence: 'Management agreed the datacenter migration deadline is codenamed SILVERPINE now.', question: 'what is the datacenter migration deadline codenamed', answer: 'SILVERPINE' },
  { sentence: 'The working group decided the audit trail retention period equals NIGHTJAR4 days exactly.', question: 'what audit trail retention period was decided', answer: 'NIGHTJAR4' },
  { sentence: 'Engineering concluded the cache invalidation strategy should be called THORNBERRY.', question: 'what is the cache invalidation strategy called', answer: 'THORNBERRY' },
  { sentence: 'We committed to promoting the staging cluster under the label FOXGLOVE2 next sprint.', question: 'under what label did we commit to promoting the staging cluster', answer: 'FOXGLOVE2' },
  { sentence: 'The board resolved that the acquisition escrow account uses identifier LANTERN88.', question: 'what identifier does the acquisition escrow account use', answer: 'LANTERN88' },
  { sentence: 'After long debate we decided the telemetry sampling rate stays at WOLFRAM3 percent.', question: 'what telemetry sampling rate did we decide on', answer: 'WOLFRAM3' },
  { sentence: 'The committee agreed the incident severity rubric is now versioned as HOLLYHOCK1.', question: 'what version is the incident severity rubric', answer: 'HOLLYHOCK1' },
  { sentence: 'Operations decided the failover region pairing will be referred to as IRONWOOD5.', question: 'what is the failover region pairing referred to as', answer: 'IRONWOOD5' },
  { sentence: 'We concluded that the customer export pipeline budget is fixed at PIMPERNEL6 dollars.', question: 'what is the customer export pipeline budget fixed at', answer: 'PIMPERNEL6' },
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

function containsAnswer(context: string, answer: string): boolean {
  return context.includes(answer)
}

// ── benchmark sections ────────────────────────────────────────────────────────
const results = loadDatasets()
if (results.length === 0) {
  console.error('no datasets found — run: node bench/fetch-data.mjs')
  process.exit(1)
}

console.log('# zettel-compress benchmark\n')
console.log(`node ${process.version} — ${new Date().toISOString().slice(0, 10)}\n`)

// 1. performance
console.log('## Performance\n')
console.log('| dataset | input tokens | zettels | compress (median ms) | tokens/ms |')
console.log('|---|---|---|---|---|')
for (const d of results) {
  const tokens = estimateTokens(d.text)
  const runs = tokens > 50_000 ? 3 : 5
  const ms = timeMs(() => compress(d.text), runs)
  const r = compress(d.text)
  console.log(
    `| ${d.name} | ${tokens.toLocaleString()} | ${r.zettels.length} | ${ms.toFixed(1)} | ${(tokens / Math.max(ms, 0.01)).toFixed(0)} |`,
  )
}

// 2. compression ratio
console.log('\n## Compression\n')
console.log('| dataset | input tokens | inject top-10 | ratio | budget-300 output | wakeUp() |')
console.log('|---|---|---|---|---|---|')
for (const d of results) {
  const r = compress(d.text)
  const inject = estimateTokens(injectContext(r, { maxZettels: 10 }))
  const budget = estimateTokens(injectContext(r, { maxTokenBudget: 300 }))
  const wake = estimateTokens(
    injectContext(r, { maxZettels: 3 }),
  )
  const tokens = estimateTokens(d.text)
  console.log(
    `| ${d.name} | ${tokens.toLocaleString()} | ${inject} | ${((inject / tokens) * 100).toFixed(2)}% | ${budget} | ${wake} |`,
  )
}

// 3. budget compliance
console.log('\n## Token budget compliance (must never exceed 100%)\n')
console.log('| dataset | budget 100 | budget 300 | budget 500 | budget 1000 |')
console.log('|---|---|---|---|---|')
for (const d of results) {
  const r = compress(d.text)
  const cells = [100, 300, 500, 1000].map((b) => {
    const out = estimateTokens(injectContext(r, { maxTokenBudget: b }))
    return `${((out / b) * 100).toFixed(0)}%`
  })
  console.log(`| ${d.name} | ${cells.join(' | ')} |`)
}

// 4. round-trip fidelity
console.log('\n## Round-trip fidelity (strict decode, deep equality)\n')
console.log('| dataset | zettels | decode(encode(r)) |')
console.log('|---|---|---|')
for (const d of results) {
  const r = compress(d.text)
  let status = 'PASS'
  try {
    const back = decode(encode(r), { strict: true })
    const sortedEntries = (o: Record<string, string>) =>
      JSON.stringify(Object.entries(o).sort((x, y) => x[0].localeCompare(y[0])))
    const same =
      JSON.stringify(back.zettels) === JSON.stringify(r.zettels) &&
      JSON.stringify(back.tunnels) === JSON.stringify(r.tunnels) &&
      sortedEntries(back.entityIndex.codeToName) === sortedEntries(r.entityIndex.codeToName)
    if (!same) status = 'FAIL (mismatch)'
  } catch (e) {
    status = `FAIL (${(e as Error).message.slice(0, 40)})`
  }
  console.log(`| ${d.name} | ${compress(d.text).zettels.length} | ${status} |`)
}

// 5. answer-in-context QA accuracy
console.log('\n## QA accuracy — answer-in-context over 12 planted decision facts\n')
console.log(
  'A method answers a question iff the unique answer token appears in its output.\n',
)
console.log(
  '| dataset | recall(q) top-5 | inject top-10 | budget-300 | first-300-tokens | random-10 zettels |',
)
console.log('|---|---|---|---|---|---|')
for (const d of results) {
  const rnd = mulberry32(0x5eed)
  const planted = plantFacts(d.text, rnd)
  const r = compress(planted)

  const inject10 = injectContext(r, { maxZettels: 10 })
  const budget300 = injectContext(r, { maxTokenBudget: 300 })
  const first300 = planted.split(/\s+/).slice(0, Math.floor(300 / 1.3)).join(' ')

  const randRnd = mulberry32(0xbada55)
  const shuffled = [...r.zettels].sort(() => randRnd() - 0.5).slice(0, 10)
  const random10 = shuffled.map((z) => z.quote).join('\n')

  let viaRecall = 0
  let viaInject = 0
  let viaBudget = 0
  let viaFirst = 0
  let viaRandom = 0
  for (const f of FACTS) {
    const hits = recall(r, f.question, { topK: 5 })
    if (containsAnswer(hits.map((z) => z.quote).join('\n'), f.answer)) viaRecall++
    if (containsAnswer(inject10, f.answer)) viaInject++
    if (containsAnswer(budget300, f.answer)) viaBudget++
    if (containsAnswer(first300, f.answer)) viaFirst++
    if (containsAnswer(random10, f.answer)) viaRandom++
  }
  const pct = (n: number) => `${((n / FACTS.length) * 100).toFixed(0)}%`
  console.log(
    `| ${d.name} | ${pct(viaRecall)} | ${pct(viaInject)} | ${pct(viaBudget)} | ${pct(viaFirst)} | ${pct(viaRandom)} |`,
  )
}

// 6. recall MRR
console.log('\n## recall() mean reciprocal rank (12 planted facts, topK 10)\n')
console.log('| dataset | MRR | found@10 |')
console.log('|---|---|---|')
for (const d of results) {
  const rnd = mulberry32(0x5eed)
  const r = compress(plantFacts(d.text, rnd))
  let mrr = 0
  let found = 0
  for (const f of FACTS) {
    const hits = recall(r, f.question, { topK: 10 })
    const rank = hits.findIndex((z) => z.quote.includes(f.answer))
    if (rank >= 0) {
      mrr += 1 / (rank + 1)
      found++
    }
  }
  console.log(
    `| ${d.name} | ${(mrr / FACTS.length).toFixed(2)} | ${found}/${FACTS.length} |`,
  )
}

// 7. entity precision/recall on a labeled fixture
console.log('\n## Entity detection on a labeled fixture\n')
const GOLD = ['Alice', 'Bob', 'Carol', 'Daniel', 'Priya', 'MemPalace', 'TypeScript', 'Cloudflare', 'Redis', 'GitHub']
const ENTITY_FIXTURE = `
Alice presented the MemPalace architecture to the platform group on Tuesday.
Added support for streaming uploads last week. Please review when free.
Bob argued that Redis fits the session store better than the alternative Carol proposed.
Ran the full migration suite overnight. Updated the dashboards afterward.
Daniel pushed the TypeScript rewrite to GitHub while Priya reviewed the Cloudflare configuration.
We deployed everything to Cloudflare and told Alice the rollout was complete.
Bumped the version. Advised waiting a day before announcing on the blog.
Carol and Priya agreed that MemPalace needs a clearer onboarding flow than GitHub offers.
`.trim()
{
  const detected = detect(ENTITY_FIXTURE)
  const tp = detected.filter((e: string) => GOLD.includes(e)).length
  const precision = detected.length > 0 ? tp / detected.length : 0
  const rec = tp / GOLD.length
  console.log(`detected: ${detected.join(', ')}`)
  console.log(`\nprecision: ${(precision * 100).toFixed(0)}%  recall: ${(rec * 100).toFixed(0)}%  (gold set: ${GOLD.length} entities)`)
}

// 8. streaming
console.log('\n## CompressStream\n')
{
  const conv = results[0]!
  const messages = conv.text.split(/\n\n+/).filter((m) => m.trim().length > 20)
  const stream = new CompressStream({ halfLifeTurns: 50, maxZettels: 200 })
  const t = performance.now()
  for (const m of messages) stream.push(m)
  const ms = performance.now() - t
  console.log(
    `pushed ${messages.length} messages in ${ms.toFixed(1)}ms (${((ms / messages.length)).toFixed(2)}ms/message), retained ${stream.size} zettels (cap 200)`,
  )
}

console.log('\ndone.')
