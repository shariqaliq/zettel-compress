import { chunkText, normalizeText } from './chunker.js'
import { detectEntities, buildEntityIndex } from './entity-detector.js'
import { resolveCoreferences } from './coreference.js'
import { extractTopics, detectSpeakerNames } from './topic-extractor.js'
import { selectKeySentence } from './sentence-scorer.js'
import { detectEmotions, computeWeight } from './emotion-detector.js'
import { detectFlags } from './flag-detector.js'
import { buildTunnels } from './tunnel-builder.js'
import { dedupeZettels } from './dedupe.js'
import { encode, decode, encodeZettelLine } from './encoder.js'
import { wakeUp, topZettels } from './layer1.js'
import { scanDocumentDates, resolveChunkDate } from './date-parser.js'
import { detectContradictions } from './contradiction.js'
import type {
  CompressResult,
  CompressOptions,
  InjectOptions,
  Zettel,
  Tunnel,
  FlagName,
  EntityIndex,
} from './types.js'

// A zettel that many tunnels touch is structurally central to the document
// (LexRank's intuition at zettel granularity). Degree centrality feeds into
// raw weight before normalization; with no tunnels this is a rank-preserving
// rescale, so tunnel-less results are unaffected.
const CENTRALITY_BLEND = 0.2

export function blendCentrality(zettels: Zettel[], tunnels: Tunnel[]): void {
  if (zettels.length === 0) return
  const degree = new Map<string, number>()
  for (const t of tunnels) {
    degree.set(t.from, (degree.get(t.from) ?? 0) + 1)
    degree.set(t.to, (degree.get(t.to) ?? 0) + 1)
  }
  const maxDegree = Math.max(0, ...degree.values())
  for (const z of zettels) {
    const centrality = maxDegree > 0 ? (degree.get(z.id) ?? 0) / maxDegree : 0
    z.weight = (1 - CENTRALITY_BLEND) * z.weight + CENTRALITY_BLEND * centrality
  }
}

/**
 * Rank-based softmax weight normalization, in place. Weights are relative
 * within one result: ranks (not raw magnitudes) are softmaxed and min-max
 * mapped to [0, 1] so scores spread across the full range regardless of raw
 * clustering. Ties in raw weight share a midrank, so equal raw scores always
 * produce equal normalized weights — input order never influences ranking.
 */
export function normalizeWeights(zettels: Zettel[], temperature = 0.5): void {
  const n = zettels.length
  if (n <= 1) return

  const order = zettels.map((z, i) => ({ i, w: z.weight })).sort((a, b) => a.w - b.w)
  const midrank = new Array<number>(n)
  let k = 0
  while (k < n) {
    let j = k
    while (j + 1 < n && order[j + 1]!.w === order[k]!.w) j++
    const avg = (k + j) / 2
    for (let t = k; t <= j; t++) midrank[order[t]!.i] = avg
    k = j + 1
  }

  // Normalize rank to [0, 1] before dividing by T so behavior is scale-independent of n
  const scaled = midrank.map((r) => (r ?? 0) / (n - 1) / temperature)
  const maxScaled = Math.max(...scaled)
  const exps = scaled.map((s) => Math.exp(s - maxScaled))
  const sumExps = exps.reduce((a, v) => a + v, 0)
  const softmax = exps.map((e) => e / sumExps)

  const sMin = Math.min(...softmax)
  const sMax = Math.max(...softmax)
  for (let i = 0; i < n; i++) {
    const normalized = sMax > sMin ? (softmax[i]! - sMin) / (sMax - sMin) : 1.0
    const z = zettels[i]
    if (z) z.weight = Math.round(normalized * 100) / 100
  }
}

export function compress(text: string, options?: CompressOptions): CompressResult {
  const normalized = normalizeText(text)
  const chunks = chunkText(normalized, options)

  if (chunks.length === 0) {
    return {
      zettels: [],
      tunnels: [],
      entityIndex: { nameToCode: {}, codeToName: {} },
      meta: { inputLength: text.length, chunkCount: 0 },
    }
  }

  // Pass 1: collect all entities globally for consistent coding
  const detectedEntities: string[][] = chunks.map((chunk) =>
    detectEntities(chunk.text, options?.minEntityFrequency),
  )
  // Pronoun chunks inherit the most recent matching entity, so a person who
  // becomes "she" after the first mention still appears in later zettels
  const chunkEntities = resolveCoreferences(chunks, detectedEntities)
  const allEntityNames = [...new Set(chunkEntities.flat())]
  const entityIndex = buildEntityIndex(allEntityNames)

  // Pre-scan the full document for absolute date anchors once — each chunk
  // resolver uses these to find the nearest preceding anchor for relative
  // expressions ("yesterday", "last week") without re-scanning the whole text
  const docDateAnchors = scanDocumentDates(normalized)

  // Detect conversation speaker names once from the full text so per-chunk
  // topic extraction can suppress them globally (not just within one chunk)
  const speakerNames = detectSpeakerNames(normalized)

  // Pass 2: build each zettel
  let zettels: Zettel[] = chunks.map((chunk, i) => {
    const entities = chunkEntities[i] ?? []
    const topics = extractTopics(chunk.text, options?.minTopicFrequency, options?.stopWords, 8, speakerNames)
    const quote = selectKeySentence(chunk.text)
    const flags = detectFlags(chunk.text)
    const emotions = detectEmotions(chunk.text)
    const weight = computeWeight(emotions, flags, chunk.text)
    const resolvedDate = resolveChunkDate(
      chunk.text,
      options?.date,
      docDateAnchors,
      chunk.charStart,
    )

    return {
      id: String(i + 1).padStart(3, '0'),
      entities,
      topics,
      quote,
      weight,
      emotions,
      flags,
      sourceStart: chunk.charStart,
      sourceEnd: chunk.charEnd,
      ...(resolvedDate !== undefined ? { resolvedDate } : {}),
    }
  })

  // Dedup runs on raw weights so the strongest copy of a repeated moment
  // survives; normalization then sees the deduplicated population
  if (options?.dedupe) {
    zettels = dedupeZettels(zettels, options.dedupeThreshold)
  }

  // Tunnels are built on raw zettels (scores don't involve weight), so
  // graph centrality can feed back into importance before normalization
  const tunnels = buildTunnels(
    zettels,
    entityIndex,
    options?.tunnelThreshold,
    options?.tunnelTopK,
    options?.verboseLabels,
  )
  blendCentrality(zettels, tunnels)

  normalizeWeights(zettels, options?.temperature)

  // Degenerate inputs produce a technically valid but meaningless zettel —
  // surface that instead of leaving callers to discover it downstream
  const MIN_MEANINGFUL_INPUT = 40
  const warnings =
    text.trim().length < MIN_MEANINGFUL_INPUT
      ? [`input is ${text.trim().length} chars — too short for meaningful compression`]
      : undefined

  const result: CompressResult = {
    zettels,
    tunnels,
    entityIndex,
    meta: Object.assign(
      { inputLength: text.length, chunkCount: chunks.length },
      options?.date !== undefined ? { date: options.date } : {},
      options?.title !== undefined ? { title: options.title } : {},
      warnings !== undefined ? { warnings } : {},
      // source enables provenance-expanded recall; offsets index into it
      options?.keepSource !== false ? { source: normalized } : {},
    ),
  }

  const contradictions = detectContradictions(result)
  if (contradictions.length > 0) result.contradictions = contradictions

  return result
}

export function compressMany(texts: string[], options?: CompressOptions): CompressResult[] {
  return texts.map((text) => compress(text, options))
}

export function mergeResults(results: CompressResult[]): CompressResult {
  if (results.length === 0) {
    return {
      zettels: [],
      tunnels: [],
      entityIndex: { nameToCode: {}, codeToName: {} },
    }
  }

  // Merge entity indexes
  const mergedIndex = { nameToCode: {} as Record<string, string>, codeToName: {} as Record<string, string> }
  const allEntityNames: string[] = []

  for (const r of results) {
    for (const name of Object.keys(r.entityIndex.nameToCode)) {
      if (!allEntityNames.includes(name)) allEntityNames.push(name)
    }
  }

  const rebuiltIndex = buildEntityIndex(allEntityNames)
  mergedIndex.nameToCode = rebuiltIndex.nameToCode
  mergedIndex.codeToName = rebuiltIndex.codeToName

  // Re-index zettel ids globally. Source offsets reference each result's own
  // text, which a merged result no longer has — drop them rather than let
  // them point into the wrong document.
  let globalIndex = 1
  const mergedZettels = results.flatMap((r) =>
    r.zettels.map((z) => {
      const { sourceStart: _s, sourceEnd: _e, ...rest } = z
      return { ...rest, id: String(globalIndex++).padStart(3, '0') }
    }),
  )

  const mergedTunnels = buildTunnels(mergedZettels, mergedIndex)
  blendCentrality(mergedZettels, mergedTunnels)

  // Per-result weights are on independent scales (single-chunk results carry
  // raw scores) — re-normalize over the merged set so filtering is consistent
  normalizeWeights(mergedZettels)

  const totalInput = results.reduce((sum, r) => sum + (r.meta?.inputLength ?? 0), 0)

  return {
    zettels: mergedZettels,
    tunnels: mergedTunnels,
    entityIndex: mergedIndex,
    meta: { inputLength: totalInput, chunkCount: mergedZettels.length },
  }
}

// Weight and signal density correlate but are not identical: a DECISION
// zettel ranked 11th by pure weight is exactly the memory the user asks for.
// Selection ranks by a combined score so flagged signals reliably surface.
const SIGNAL_FLAGS: FlagName[] = ['DECISION', 'ORIGIN', 'CORE']

function selectionScore(z: Zettel): number {
  const bonus = z.flags.some((f) => SIGNAL_FLAGS.includes(f)) ? 1 : 0
  return 0.7 * z.weight + 0.3 * bonus
}

function zettelSim(a: Zettel, b: Zettel): number {
  const setA = new Set([...a.topics, ...a.entities])
  const setB = new Set([...b.topics, ...b.entities])
  if (setA.size === 0 || setB.size === 0) return 0
  let inter = 0
  for (const t of setA) if (setB.has(t)) inter++
  const union = setA.size + setB.size - inter
  return union > 0 ? inter / union : 0
}

function selectTop(zettels: Zettel[], n: number, mode: 'weight' | 'mmr'): Zettel[] {
  const byScore = [...zettels].sort(
    (a, b) => selectionScore(b) - selectionScore(a) || a.id.localeCompare(b.id),
  )
  if (mode !== 'mmr' || byScore.length <= n) return byScore.slice(0, n)

  // Maximal marginal relevance (Carbonell & Goldstein 1998): each pick trades
  // relevance against the strongest similarity to anything already selected
  const LAMBDA = 0.7
  const selected: Zettel[] = []
  const pool = [...byScore]
  while (selected.length < n && pool.length > 0) {
    let bestIdx = 0
    let bestVal = -Infinity
    for (let i = 0; i < pool.length; i++) {
      const z = pool[i]!
      const maxSim = selected.length > 0 ? Math.max(...selected.map((s) => zettelSim(z, s))) : 0
      const val = LAMBDA * selectionScore(z) - (1 - LAMBDA) * maxSim
      if (val > bestVal) {
        bestVal = val
        bestIdx = i
      }
    }
    selected.push(pool.splice(bestIdx, 1)[0]!)
  }
  return selected
}

function applyGuarantees(selected: Zettel[], candidates: Zettel[], flags: FlagName[]): Zettel[] {
  const out = [...selected]
  for (const flag of flags) {
    if (out.some((z) => z.flags.includes(flag))) continue
    const best = candidates
      .filter((z) => z.flags.includes(flag) && !out.includes(z))
      .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))[0]
    if (!best) continue

    // replace the weakest selected zettel that is not itself guaranteed
    let victim = -1
    let victimScore = Infinity
    for (let i = 0; i < out.length; i++) {
      const z = out[i]!
      if (flags.some((f) => z.flags.includes(f))) continue
      const s = selectionScore(z)
      if (s < victimScore) {
        victimScore = s
        victim = i
      }
    }
    if (victim >= 0) out[victim] = best
    else out.push(best)
  }
  return out
}

/**
 * Token estimate the budget enforces: word count with a character floor, so
 * dense whitespace-free runs (AAAK code lines) cannot hide from the budget.
 */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.ceil(Math.max(words * 1.3, text.length / 4))
}

function markdownLine(z: Zettel): string {
  const parts: string[] = []
  if (z.resolvedDate) parts.push(z.resolvedDate)
  if (z.flags.length > 0) parts.push(z.flags.join(', '))
  const header = parts.length > 0 ? `**[${z.id}]** *(${parts.join(' · ')})* ` : `**[${z.id}]** `
  return `${header}${z.quote}`
}

function tunnelsAmong(tunnels: Tunnel[], zettels: Zettel[]): Tunnel[] {
  const ids = new Set(zettels.map((z) => z.id))
  return tunnels.filter((t) => ids.has(t.from) && ids.has(t.to))
}

// Only the selected zettels' entities belong in the E: index line — on a
// large document the full index alone can dwarf any sane token budget
function indexFor(zettels: Zettel[], full: EntityIndex): EntityIndex {
  const names = new Set(zettels.flatMap((z) => z.entities))
  const nameToCode: Record<string, string> = {}
  const codeToName: Record<string, string> = {}
  for (const name of names) {
    const code = full.nameToCode[name]
    if (code !== undefined) {
      nameToCode[name] = code
      codeToName[code] = name
    }
  }
  return { nameToCode, codeToName }
}

function renderOutput(
  result: CompressResult,
  zettels: Zettel[],
  format: 'aaak' | 'json' | 'markdown',
): string {
  const tunnels = tunnelsAmong(result.tunnels, zettels)
  if (format === 'json') return JSON.stringify({ zettels, tunnels }, null, 2)
  if (format === 'markdown') return zettels.map(markdownLine).join('\n\n')
  return encode({
    ...result,
    zettels,
    tunnels,
    entityIndex: indexFor(zettels, result.entityIndex),
  })
}

// Greedy budget fit: zettels enter in weight order, each measured as it would
// actually render, and the budget is never exceeded. Tunnel lines (aaak/json)
// are added last with whatever budget remains.
function zettelLineFor(
  z: Zettel,
  result: CompressResult,
  format: 'aaak' | 'json' | 'markdown',
): string {
  if (format === 'json') return JSON.stringify(z, null, 2)
  if (format === 'markdown') return markdownLine(z)
  return encodeZettelLine(z, result.entityIndex)
}

function fitToBudget(
  result: CompressResult,
  candidates: Zettel[],
  format: 'aaak' | 'json' | 'markdown',
  budget: number,
  countTokens: (text: string) => number,
): Zettel[] {
  const sorted = [...candidates].sort(
    (a, b) => selectionScore(b) - selectionScore(a) || a.id.localeCompare(b.id),
  )
  const selected: Zettel[] = []
  let used = countTokens(renderOutput(result, selected, format))

  // first-fit-decreasing: an oversized zettel doesn't end selection — lower
  // ranked but smaller zettels can still use the remaining budget. A zettel's
  // own rendered line is a lower bound on what it adds (index and tunnel
  // lines only grow the output), so hopeless candidates are skipped without
  // re-rendering the whole selection.
  for (const z of sorted) {
    if (used + countTokens(zettelLineFor(z, result, format)) > budget) continue
    const attempt = renderOutput(result, [...selected, z], format)
    const attemptTokens = countTokens(attempt)
    if (attemptTokens > budget) continue
    selected.push(z)
    used = attemptTokens
  }

  return selected
}

export function injectContext(result: CompressResult, options?: InjectOptions): string {
  let zettels = [...result.zettels]

  if (options?.minWeight !== undefined) {
    const min = options.minWeight
    zettels = zettels.filter((z) => z.weight >= min)
  }

  if (options?.flags !== undefined && options.flags.length > 0) {
    const flagSet = options.flags
    zettels = zettels.filter((z) => flagSet.some((f) => z.flags.includes(f)))
  }

  if (options?.maxZettels !== undefined) {
    zettels = selectTop(zettels, options.maxZettels, options.selection ?? 'weight')
  }

  // Guarantees draw from the full result, so a flagged zettel excluded by
  // minWeight or ranking still makes it in
  if (options?.guaranteeFlags !== undefined && options.guaranteeFlags.length > 0) {
    zettels = applyGuarantees(zettels, result.zettels, options.guaranteeFlags)
  }

  const format = options?.format ?? 'aaak'

  // Budget is the final gate: measure real rendered output, never exceed
  if (options?.maxTokenBudget !== undefined) {
    zettels = fitToBudget(
      result,
      zettels,
      format,
      options.maxTokenBudget,
      options.countTokens ?? estimateTokens,
    )
  }

  return renderOutput(result, zettels, format)
}

export { encode, decode, encodeZettelLine, encodeTunnelLine } from './encoder.js'
export { wakeUp, topZettels } from './layer1.js'
export { recall, recallContext } from './recall.js'
export type { RecallOptions, RecallContextOptions } from './recall.js'
export { CompressStream } from './stream.js'
export type { StreamOptions } from './stream.js'
export { detectContradictions } from './contradiction.js'
export { ALL_FLAGS, ALL_EMOTIONS } from './types.js'
export type {
  Zettel,
  Tunnel,
  EntityIndex,
  Contradiction,
  CompressResult,
  CompressOptions,
  InjectOptions,
  DecodeOptions,
  TextChunk,
  FlagName,
  EmotionName,
} from './types.js'
