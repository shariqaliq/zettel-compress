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
  /**
   * Markov topic expansion: before BM25, expand each query token one hop
   * through the topic co-occurrence chain built from the compressed result.
   * Expands "auth" → ["token", "session", "login", ...] automatically.
   * Expanded terms are weighted at 0.5× originals in BM25 scoring.
   * Default false (opt-in — adds a small build step on first call, cached).
   */
  expandQuery?: boolean
  /**
   * Only return zettels whose resolvedDate is on or after this ISO date
   * (YYYY-MM-DD, YYYY-MM, or YYYY). Zettels with no resolvedDate are excluded
   * when this filter is set.
   */
  after?: string
  /**
   * Only return zettels whose resolvedDate is on or before this ISO date
   * (YYYY-MM-DD, YYYY-MM, or YYYY). Zettels with no resolvedDate are excluded
   * when this filter is set.
   */
  before?: string
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that',
  'these', 'those', 'we', 'you', 'i', 'they', 'he', 'she', 'about', 'what',
  'did', 'do', 'does', 'our', 'your', 'their', 'his', 'her', 'have', 'has',
  'had', 'will', 'would', 'can', 'could', 'should', 'how', 'when', 'where',
])

// ── #1 Synonym expansion ──────────────────────────────────────────────────────
// Hand-curated synonym clusters for concepts that commonly paraphrase in
// conversational QA. Each entry is a set of equivalent stems (post-fold).
// Applied only to query tokens, never to document tokens, so idf is unchanged.
// Abbreviation pairs (nyc/new york) are included; fold() is applied to both
// sides so inflections still unify.
const SYNONYM_CLUSTERS: string[][] = [
  // movement / relocation
  ['move', 'reloc', 'transfer', 'migrat'],
  // employment
  ['job', 'work', 'career', 'profession', 'occupat', 'employ'],
  // marriage / relationship
  ['marri', 'wed', 'spous', 'husband', 'wife', 'partner', 'engag'],
  // start something
  ['start', 'begin', 'launch', 'found', 'creat', 'open', 'establish'],
  // stop / end
  ['stop', 'quit', 'leav', 'end', 'finish', 'resign', 'retir'],
  // purchase / acquire
  ['buy', 'purchas', 'acquir', 'get', 'obtain'],
  // study / education
  ['studi', 'learn', 'school', 'colleg', 'univers', 'degre', 'graduat'],
  // visit / travel
  ['visit', 'travel', 'trip', 'go', 'went'],
  // live / reside
  ['live', 'resid', 'stay', 'settl'],
  // like / enjoy
  ['like', 'love', 'enjoy', 'prefer', 'favour', 'favor'],
  // city abbreviations (pre-fold)
  ['nyc', 'new york'],
  ['la', 'los angel'],
  ['sf', 'san francisco'],
  ['dc', 'washington'],
  ['uk', 'united kingdom', 'britain'],
  ['us', 'united stat', 'america'],
]

// Build token → cluster-mates map at module load (one-time)
const SYNONYM_MAP = new Map<string, string[]>()
for (const cluster of SYNONYM_CLUSTERS) {
  const folded = cluster.map(fold)
  for (let i = 0; i < folded.length; i++) {
    const mates = folded.filter((_, j) => j !== i)
    const existing = SYNONYM_MAP.get(folded[i]!) ?? []
    SYNONYM_MAP.set(folded[i]!, [...new Set([...existing, ...mates])])
  }
}

// ── #2 Temporal date extraction from query ────────────────────────────────────
// Patterns that match explicit date references in questions. Captured groups
// are normalised to ISO prefix strings for comparison against resolvedDate.
const RE_YEAR_MONTH = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[\s,]*(\d{4})\b/gi
const RE_MONTH_YEAR = /\b(\d{4})\b[\s,]*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi
const RE_YEAR_ONLY  = /\b(20\d{2}|19\d{2})\b/g

const MONTH_NUM: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

function monthNum(name: string): string {
  return MONTH_NUM[name.slice(0, 3).toLowerCase()] ?? '01'
}

// Extract all ISO date prefixes mentioned in a query string.
// Returns e.g. ["2022-03", "2021"] — used to boost zettels whose resolvedDate
// starts with (or is a prefix-match of) any extracted date.
function extractQueryDates(query: string): string[] {
  const dates: string[] = []
  let m: RegExpExecArray | null

  RE_YEAR_MONTH.lastIndex = 0
  while ((m = RE_YEAR_MONTH.exec(query)) !== null) {
    dates.push(`${m[2]}-${monthNum(m[1]!)}`)
  }
  RE_MONTH_YEAR.lastIndex = 0
  while ((m = RE_MONTH_YEAR.exec(query)) !== null) {
    dates.push(`${m[1]}-${monthNum(m[2]!)}`)
  }
  // year-only only if no month found
  if (dates.length === 0) {
    RE_YEAR_ONLY.lastIndex = 0
    while ((m = RE_YEAR_ONLY.exec(query)) !== null) {
      dates.push(m[1]!)
    }
  }
  return [...new Set(dates)]
}

// Score bonus for a zettel whose resolvedDate matches a query date prefix.
// Exact prefix match = 0.25; adjacent month (±1) = 0.10.
function dateBonus(z: Zettel, queryDates: string[]): number {
  if (!z.resolvedDate || queryDates.length === 0) return 0
  for (const qd of queryDates) {
    const zd = z.resolvedDate
    // exact prefix match: "2022-03" matches "2022-03-15" or "2022-03"
    if (zd.startsWith(qd) || qd.startsWith(zd)) return 0.25
    // adjacent month: both are YYYY-MM
    if (qd.length === 7 && zd.length >= 7) {
      const qMonth = parseInt(qd.slice(5, 7), 10)
      const zMonth = parseInt(zd.slice(5, 7), 10)
      const qYear  = parseInt(qd.slice(0, 4), 10)
      const zYear  = parseInt(zd.slice(0, 4), 10)
      const diff = (zYear - qYear) * 12 + (zMonth - qMonth)
      if (Math.abs(diff) === 1) return 0.10
    }
  }
  return 0
}

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

// ── Markov topic chain ────────────────────────────────────────────────────────
// co-occurrence map: token → (neighbor → count), built from zettel topics+entities
type CoMap = Map<string, Map<string, number>>

const CHAIN_CACHE = new WeakMap<object, CoMap>()

function buildTopicChain(result: CompressResult): CoMap {
  const cached = CHAIN_CACHE.get(result.zettels)
  if (cached) return cached

  const co: CoMap = new Map()
  const bump = (a: string, b: string) => {
    if (a === b) return
    if (!co.has(a)) co.set(a, new Map())
    co.get(a)!.set(b, (co.get(a)!.get(b) ?? 0) + 1)
  }

  for (const z of result.zettels) {
    // fold topics + entities through the same stemmer used in BM25
    const terms = tokenize(z.topics.concat(z.entities).join(' '))
    for (let i = 0; i < terms.length; i++) {
      for (let j = i + 1; j < terms.length; j++) {
        bump(terms[i]!, terms[j]!)
        bump(terms[j]!, terms[i]!)
      }
    }
  }

  CHAIN_CACHE.set(result.zettels, co)
  return co
}

// Return up to topN expansion tokens for a single query token, sorted by
// co-occurrence count desc, alpha asc for ties (deterministic).
function expandToken(token: string, chain: CoMap, topN: number): string[] {
  const nbrs = chain.get(token)
  if (!nbrs) return []
  return [...nbrs.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([t]) => t)
}

// BM25 with per-token weights: originals at 1.0, expansions at expandWeight.
function bm25WeightedScores(
  docs: string[][],
  qTokens: string[],
  extraTokens: Map<string, number>, // token → weight multiplier
): number[] {
  const N = docs.length
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / N || 1
  const df = new Map<string, number>()
  for (const d of docs) {
    for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
  }

  const allQ = [...new Set([...qTokens, ...extraTokens.keys()])]

  return docs.map((d) => {
    const tf = new Map<string, number>()
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1)
    let score = 0
    for (const q of allQ) {
      const f = tf.get(q) ?? 0
      if (f === 0) continue
      const n = df.get(q) ?? 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      const bm = (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * d.length) / avgLen))
      const w = extraTokens.get(q) ?? 1.0
      score += bm * w
    }
    return score
  })
}

// ── Personalized PageRank ─────────────────────────────────────────────────────
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
// ISO date string prefix comparison: "2023-06" >= "2023-05" works lexically
// because the format is zero-padded and left-aligned by specificity.
function dateGte(a: string, b: string): boolean { return a.slice(0, b.length) >= b }
function dateLte(a: string, b: string): boolean { return a.slice(0, b.length) <= b }

export function recall(
  result: CompressResult,
  query: string,
  options?: RecallOptions,
): Zettel[] {
  const topK = options?.topK ?? 5
  const hops = options?.hops ?? true
  const expand = options?.expandQuery ?? false
  const after = options?.after
  const before = options?.before

  // Apply date range filter first — reduces the working set before BM25
  let zettels = result.zettels
  if (after !== undefined || before !== undefined) {
    zettels = zettels.filter((z) => {
      if (!z.resolvedDate) return false
      if (after !== undefined && !dateGte(z.resolvedDate, after)) return false
      if (before !== undefined && !dateLte(z.resolvedDate, before)) return false
      return true
    })
  }

  if (zettels.length === 0 || topK <= 0) return []

  const qTokens = tokenize(query)
  if (qTokens.length === 0) return []

  // #1 — synonym expansion: add cluster-mates of each query token at 0.6×
  // weight so a query for "moved" also matches "relocated", "transferred", etc.
  const source = result.meta?.source
  const docs = zettels.map((z) => zettelTokens(z, source))

  // Always use weighted BM25 so synonyms and Markov expansions share one path
  const extraTokens = new Map<string, number>()
  for (const qt of qTokens) {
    for (const syn of SYNONYM_MAP.get(qt) ?? []) {
      if (!qTokens.includes(syn)) {
        extraTokens.set(syn, Math.max(extraTokens.get(syn) ?? 0, 0.6))
      }
    }
  }
  if (expand) {
    const chain = buildTopicChain(result)
    for (const qt of qTokens) {
      for (const exp of expandToken(qt, chain, 3)) {
        if (!qTokens.includes(exp) && !extraTokens.has(exp)) {
          extraTokens.set(exp, 0.5)
        }
      }
    }
  }
  const bm25 = extraTokens.size > 0
    ? bm25WeightedScores(docs, qTokens, extraTokens)
    : bm25Scores(docs, qTokens)

  const maxB = Math.max(...bm25)
  if (maxB <= 0) return []
  const bNorm = bm25.map((s) => s / maxB)

  // #2 — date proximity bonus: extract year/month from query, boost zettels
  // whose resolvedDate matches. Bonus is additive before normalization so it
  // can promote a near-miss zettel above a slightly higher BM25 hit.
  const queryDates = extractQueryDates(query)
  const withDateBonus = bNorm.map((s, i) => s + dateBonus(zettels[i]!, queryDates))

  let final = withDateBonus
  if (hops && result.tunnels.length > 0) {
    const ppr = personalizedPageRank(zettels, result, withDateBonus)
    const maxR = Math.max(...ppr)
    const rNorm = maxR > 0 ? ppr.map((r) => r / maxR) : ppr
    final = withDateBonus.map((s, i) => 0.6 * s + 0.4 * (rNorm[i] ?? 0))
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
