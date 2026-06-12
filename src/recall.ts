import type { CompressResult, Zettel } from './types.js'
import { estimateTokens } from './index.js'

export interface RecallOptions {
  /** Maximum zettels returned (default 5) */
  topK?: number
  /**
   * Expand results over the tunnel graph with personalized PageRank, so
   * zettels associated with a direct hit surface even when they share no
   * query terms (default true).
   */
  hops?: boolean
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that',
  'these', 'those', 'we', 'you', 'i', 'they', 'he', 'she', 'about', 'what',
  'did', 'do', 'does', 'our', 'your', 'their', 'his', 'her', 'have', 'has',
  'had', 'will', 'would', 'can', 'could', 'should', 'how', 'when', 'where',
])

// Poor man's stemmer: fold common inflection suffixes so "rotation",
// "rotate", and "rotating" share a stem. The stem need not be a word —
// both documents and queries pass through the same fold, so they meet in
// the middle. These exact morphology gaps dominated QA misses in the
// LLM-judged evaluation.
function fold(t: string): string {
  let s = t
  if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y'
  else if (s.length > 4 && /(?:ch|sh|ss|x|z)es$/.test(s)) s = s.slice(0, -2)
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss') && !s.endsWith('us')) {
    s = s.slice(0, -1)
  }
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3)
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2)
  if (s.length > 5 && (s.endsWith('tion') || s.endsWith('sion'))) s = s.slice(0, -3)
  if (s.length > 5 && s.endsWith('ly')) s = s.slice(0, -2)
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1)
  // collapse doubled final consonant left by -ing/-ed stripping (capp → cap)
  if (s.length > 3 && s[s.length - 1] === s[s.length - 2] && !/[aeiou]/.test(s[s.length - 1]!)) {
    s = s.slice(0, -1)
  }
  return s
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t))
    .map(fold)
}

function spanText(z: Zettel, source: string | undefined): string | undefined {
  if (source === undefined || z.sourceStart === undefined || z.sourceEnd === undefined) {
    return undefined
  }
  return source.slice(z.sourceStart, z.sourceEnd)
}

// When the source text is available, BM25 indexes the zettel's full source
// chunk — detail questions match content the one-sentence quote dropped.
// Without source (e.g. decoded AAAK), it falls back to quote+topics+entities.
function zettelTokens(z: Zettel, source: string | undefined): string[] {
  const body = spanText(z, source) ?? z.quote
  return tokenize(`${body} ${z.topics.join(' ')} ${z.entities.join(' ')}`)
}

// Okapi BM25 with the standard k1=1.2, b=0.75
function bm25Scores(docs: string[][], qTokens: string[]): number[] {
  const N = docs.length
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / N || 1
  const df = new Map<string, number>()
  for (const d of docs) {
    for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
  }

  return docs.map((d) => {
    const tf = new Map<string, number>()
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1)
    let score = 0
    for (const q of qTokens) {
      const f = tf.get(q) ?? 0
      if (f === 0) continue
      const n = df.get(q) ?? 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * d.length) / avgLen))
    }
    return score
  })
}

// Personalized PageRank over the (undirected) tunnel graph, teleporting to
// the BM25 hit distribution. Power iteration; the graph is capped at
// tunnelTopK edges per zettel, so 20 iterations converge comfortably.
function personalizedPageRank(
  zettels: Zettel[],
  result: CompressResult,
  seed: number[],
): number[] {
  const n = zettels.length
  const idToIdx = new Map(zettels.map((z, i) => [z.id, i]))
  const adj: number[][] = Array.from({ length: n }, () => [])
  for (const t of result.tunnels) {
    const a = idToIdx.get(t.from)
    const b = idToIdx.get(t.to)
    if (a === undefined || b === undefined) continue
    adj[a]!.push(b)
    adj[b]!.push(a)
  }

  const seedSum = seed.reduce((a, v) => a + v, 0)
  if (seedSum === 0) return seed
  const p = seed.map((s) => s / seedSum)

  const ALPHA = 0.85
  let rank = [...p]
  for (let iter = 0; iter < 20; iter++) {
    const next = p.map((pi) => (1 - ALPHA) * pi)
    for (let i = 0; i < n; i++) {
      const out = adj[i]!.length
      if (out === 0) {
        // dangling mass teleports back to the personalization vector
        for (let j = 0; j < n; j++) next[j]! += ALPHA * rank[i]! * p[j]!
      } else {
        const share = (ALPHA * rank[i]!) / out
        for (const j of adj[i]!) next[j]! += share
      }
    }
    rank = next
  }
  return rank
}

/**
 * Query-time retrieval over a compressed result: BM25 over each zettel's
 * quote, topics, and entities, optionally blended with personalized PageRank
 * over the tunnel graph for one-hop associative recall. Deterministic; ties
 * break by zettel id.
 */
export function recall(
  result: CompressResult,
  query: string,
  options?: RecallOptions,
): Zettel[] {
  const topK = options?.topK ?? 5
  const hops = options?.hops ?? true
  const zettels = result.zettels
  if (zettels.length === 0 || topK <= 0) return []

  const qTokens = tokenize(query)
  if (qTokens.length === 0) return []

  const source = result.meta?.source
  const docs = zettels.map((z) => zettelTokens(z, source))
  const bm25 = bm25Scores(docs, qTokens)
  const maxB = Math.max(...bm25)
  if (maxB <= 0) return []
  const bNorm = bm25.map((s) => s / maxB)

  let final = bNorm
  if (hops && result.tunnels.length > 0) {
    const ppr = personalizedPageRank(zettels, result, bNorm)
    const maxR = Math.max(...ppr)
    const rNorm = maxR > 0 ? ppr.map((r) => r / maxR) : ppr
    final = bNorm.map((s, i) => 0.6 * s + 0.4 * (rNorm[i] ?? 0))
  }

  return zettels
    .map((z, i) => ({ z, s: final[i] ?? 0 }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.z.id.localeCompare(b.z.id))
    .slice(0, topK)
    .map((x) => x.z)
}

export interface RecallContextOptions extends RecallOptions {
  /** Hard cap on the assembled context (built-in token estimate) */
  maxTokens?: number
  /** Source text override when result.meta.source is absent (e.g. after decode) */
  source?: string
}

interface Span {
  start: number
  end: number
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const merged: Span[] = []
  for (const s of sorted) {
    const last = merged[merged.length - 1]
    if (last && s.start <= last.end + 2) {
      last.end = Math.max(last.end, s.end)
    } else {
      merged.push({ ...s })
    }
  }
  return merged
}

/**
 * Small-to-big retrieval: match on the compact zettel index, return the full
 * source passages the hits came from — the parent-document pattern. Spans of
 * overlapping hits merge, the token budget admits passages in rank order, and
 * the final context is assembled in document order so narrative and temporal
 * flow survive. Falls back to quotes when no source text is available.
 */
export function recallContext(
  result: CompressResult,
  query: string,
  options?: RecallContextOptions,
): string {
  const source = options?.source ?? result.meta?.source
  const hits = recall(result, query, options)
  if (hits.length === 0) return ''

  if (source === undefined) {
    const quotes = hits.map((z) => z.quote)
    if (options?.maxTokens === undefined) return quotes.join('\n')
    const kept: string[] = []
    for (const q of quotes) {
      if (estimateTokens([...kept, q].join('\n')) > options.maxTokens) break
      kept.push(q)
    }
    return kept.join('\n')
  }

  // budget admits passages in rank order; output assembles in document order
  let accepted: Span[] = []
  for (const z of hits) {
    if (z.sourceStart === undefined || z.sourceEnd === undefined) continue
    const candidate = mergeSpans([...accepted, { start: z.sourceStart, end: z.sourceEnd }])
    if (options?.maxTokens !== undefined) {
      const text = candidate.map((s) => source.slice(s.start, s.end)).join('\n\n')
      if (estimateTokens(text) > options.maxTokens && accepted.length > 0) continue
    }
    accepted = candidate
  }

  if (accepted.length === 0) return hits.map((z) => z.quote).join('\n')
  return accepted.map((s) => source.slice(s.start, s.end)).join('\n\n')
}
