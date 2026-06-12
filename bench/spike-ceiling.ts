/**
 * Retrieval-ceiling diagnosis on LoCoMo (categories 1, 2, 4), no LLM calls:
 *   1. corpus ceiling — does the gold answer appear verbatim ANYWHERE in the
 *      conversation text? (upper bound for any substring-based retrieval)
 *   2. answer-in-context at top-10/20/30 under BM25
 *   3. the same with chunkSize 400 (finer-grained index)
 * Tells us whether remaining headroom is rank depth, chunk granularity, or
 * vocabulary mismatch that no lexical method can recover.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compress } from './harness-imports.js'

const HERE = dirname(fileURLToPath(import.meta.url))

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that',
  'we', 'you', 'i', 'they', 'he', 'she', 'did', 'do', 'does', 'what', 'when',
  'where', 'how', 'why', 'which', 'who',
])
const words = (t: string) =>
  t.toLowerCase().split(/[^a-z0-9']+/).filter((x) => x.length >= 2 && !STOP.has(x))

function bm25All(docs: string[][], q: string[]): number[] {
  const N = docs.length
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / N || 1
  const df = new Map<string, number>()
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
  return docs.map((d) => {
    const tf = new Map<string, number>()
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1)
    let score = 0
    for (const t of q) {
      const f = tf.get(t) ?? 0
      if (f === 0) continue
      const n = df.get(t) ?? 0
      score += (Math.log(1 + (N - n + 0.5) / (n + 0.5)) * f * 2.2) /
        (f + 1.2 * (0.25 + (0.75 * d.length) / avgLen))
    }
    return score
  })
}

interface Turn { speaker: string; text?: string; blip_caption?: string }
interface QA { question: string; answer?: unknown; category: number }
interface Sample { qa: QA[]; conversation: Record<string, unknown> }

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

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((t) => t.length > 0 && !['a', 'an', 'the'].includes(t)).join(' ')

const data = JSON.parse(readFileSync(join(HERE, 'data', 'locomo10.json'), 'utf8')) as Sample[]

for (const chunkSize of [800, 400]) {
  let total = 0
  let inCorpus = 0
  const atK = new Map<number, number>([[10, 0], [20, 0], [30, 0]])

  for (const sample of data) {
    const text = conversationText(sample.conversation)
    const memory = compress(text, { chunkSize })
    const source = memory.meta!.source!
    const chunks = memory.zettels.map((z) => norm(source.slice(z.sourceStart!, z.sourceEnd!)))
    const docs = memory.zettels.map((z) => words(source.slice(z.sourceStart!, z.sourceEnd!)))
    const corpusNorm = norm(text)

    for (const qa of sample.qa) {
      if (![1, 2, 4].includes(qa.category)) continue
      const gold = qa.answer === null || qa.answer === undefined ? '' : String(qa.answer)
      if (!gold) continue
      total++
      const goldNorm = norm(gold)
      if (corpusNorm.includes(goldNorm)) inCorpus++

      const scores = bm25All(docs, words(qa.question))
      const ranked = chunks
        .map((c, i) => ({ c, s: scores[i]! }))
        .sort((a, b) => b.s - a.s)
      for (const k of atK.keys()) {
        if (ranked.slice(0, k).some((r) => r.c.includes(goldNorm))) {
          atK.set(k, atK.get(k)! + 1)
        }
      }
    }
  }

  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`
  console.log(`chunkSize ${chunkSize}: corpus ceiling ${pct(inCorpus)} | ` +
    `in-context @10 ${pct(atK.get(10)!)} @20 ${pct(atK.get(20)!)} @30 ${pct(atK.get(30)!)} ` +
    `(n=${total})`)
}