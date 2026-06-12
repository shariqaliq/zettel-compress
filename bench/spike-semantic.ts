/**
 * L2 spike: do static word vectors lift the retrieval ceiling?
 *
 * Measures answer-in-context@top-10 on LoCoMo-10 (categories 1, 2, 4 —
 * extractive answers) under three rankings over the same zettel index:
 *   - BM25 over source chunks (current recall ranking, no PPR)
 *   - pure cosine of mean GloVe-50d vectors (query vs chunk)
 *   - blends of the two
 * No LLM calls — the metric is whether the gold answer string appears in the
 * top-10 retrieved source chunks. This is the retrieval ceiling that bounds
 * downstream QA accuracy.
 *
 * Needs bench/data/glove.6B.50d.txt and bench/data/locomo10.json.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compress, estimateTokens } from './harness-imports.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const VOCAB_LIMIT = 100_000
const DIM = 50
const TOPK = 10

// ── embeddings ───────────────────────────────────────────────────────────────
console.error('loading GloVe vectors...')
const vectors = new Map<string, Float32Array>()
{
  const text = readFileSync(join(HERE, 'data', 'glove.6B.50d.txt'), 'utf8')
  let count = 0
  let pos = 0
  while (pos < text.length && count < VOCAB_LIMIT) {
    const nl = text.indexOf('\n', pos)
    const line = text.slice(pos, nl === -1 ? text.length : nl)
    pos = nl === -1 ? text.length : nl + 1
    const sp = line.indexOf(' ')
    if (sp <= 0) continue
    const word = line.slice(0, sp)
    const parts = line.slice(sp + 1).split(' ')
    const v = new Float32Array(DIM)
    for (let i = 0; i < DIM; i++) v[i] = parseFloat(parts[i] ?? '0')
    vectors.set(word, v)
    count++
  }
  console.error(`loaded ${vectors.size.toLocaleString()} vectors`)
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that',
  'we', 'you', 'i', 'they', 'he', 'she', 'did', 'do', 'does', 'what', 'when',
  'where', 'how', 'why', 'which', 'who',
])

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9']+/).filter((t) => t.length >= 2 && !STOP.has(t))
}

function embed(text: string): Float32Array | null {
  const v = new Float32Array(DIM)
  let n = 0
  for (const w of words(text)) {
    const wv = vectors.get(w)
    if (!wv) continue
    for (let i = 0; i < DIM; i++) v[i]! += wv[i]!
    n++
  }
  if (n === 0) return null
  let norm = 0
  for (let i = 0; i < DIM; i++) norm += v[i]! * v[i]!
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < DIM; i++) v[i]! /= norm
  return v
}

function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < DIM; i++) s += a[i]! * b[i]!
  return s
}

// ── BM25 (mirror of recall's parameters) ─────────────────────────────────────
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
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * d.length) / avgLen))
    }
    return score
  })
}

// ── dataset (same construction as bench/locomo.ts) ───────────────────────────
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

function normTokens(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((t) => t.length > 0 && !['a', 'an', 'the'].includes(t)).join(' ')
}

// ── run ───────────────────────────────────────────────────────────────────────
const data = JSON.parse(readFileSync(join(HERE, 'data', 'locomo10.json'), 'utf8')) as Sample[]
const BLENDS = [0, 0.3, 0.5, 0.7, 1] // weight on cosine; 0 = pure BM25

let totalQ = 0
const hits = new Map<number, number>()
const mrr = new Map<number, number>()
for (const b of BLENDS) {
  hits.set(b, 0)
  mrr.set(b, 0)
}

for (const sample of data) {
  const memory = compress(conversationText(sample.conversation))
  const source = memory.meta!.source!
  const chunks = memory.zettels.map((z) => source.slice(z.sourceStart!, z.sourceEnd!))
  const docs = chunks.map(words)
  const chunkVecs = chunks.map((c) => embed(c))

  for (const qa of sample.qa) {
    if (![1, 2, 4].includes(qa.category)) continue
    const gold = qa.answer === null || qa.answer === undefined ? '' : String(qa.answer)
    if (!gold) continue
    totalQ++

    const qWords = words(qa.question)
    const bm = bm25All(docs, qWords)
    const maxBm = Math.max(...bm, 1e-9)
    const qVec = embed(qa.question)
    const cos = chunkVecs.map((cv) => (qVec && cv ? cosine(qVec, cv) : 0))
    const maxCos = Math.max(...cos.map(Math.abs), 1e-9)

    const goldNorm = normTokens(gold)
    for (const b of BLENDS) {
      const ranked = chunks
        .map((c, i) => ({ c, s: (1 - b) * (bm[i]! / maxBm) + b * (cos[i]! / maxCos) }))
        .sort((x, y) => y.s - x.s)
        .slice(0, TOPK)
      const rank = ranked.findIndex((r) => normTokens(r.c).includes(goldNorm))
      if (rank >= 0) {
        hits.set(b, hits.get(b)! + 1)
        mrr.set(b, mrr.get(b)! + 1 / (rank + 1))
      }
    }
  }
}

console.log(`# L2 spike — GloVe-50d vs BM25, answer-in-context@top-${TOPK}`)
console.log(`${totalQ} extractive questions (categories 1, 2, 4)\n`)
console.log('| ranking | answer-in-context@10 | MRR |')
console.log('|---|---|---|')
for (const b of BLENDS) {
  const label = b === 0 ? 'BM25 only' : b === 1 ? 'cosine only' : `blend ${1 - b} BM25 + ${b} cos`
  console.log(
    `| ${label} | ${((hits.get(b)! / totalQ) * 100).toFixed(1)}% | ${(mrr.get(b)! / totalQ).toFixed(3)} |`,
  )
}
console.log(`\nembedding table cost: ${vectors.size.toLocaleString()} words × ${DIM}d ≈ ${(vectors.size * DIM / 1024 / 1024 * 1).toFixed(0)}MB float32 (~${(vectors.size * DIM / 1024 / 1024 / 4).toFixed(0)}MB int8)`)
