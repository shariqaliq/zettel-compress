import { chunkText } from './chunker.js'
import { detectEntities, buildEntityIndex } from './entity-detector.js'
import { extractTopics } from './topic-extractor.js'
import { selectKeySentence } from './sentence-scorer.js'
import { detectEmotions, computeWeight } from './emotion-detector.js'
import { detectFlags } from './flag-detector.js'
import { buildTunnels } from './tunnel-builder.js'
import { encode, decode } from './encoder.js'
import { wakeUp, topZettels } from './layer1.js'
import type { CompressResult, CompressOptions, InjectOptions, Zettel, Tunnel } from './types.js'

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
  const chunks = chunkText(text, options)

  if (chunks.length === 0) {
    return {
      zettels: [],
      tunnels: [],
      entityIndex: { nameToCode: {}, codeToName: {} },
      meta: { inputLength: text.length, chunkCount: 0 },
    }
  }

  // Pass 1: collect all entities globally for consistent coding
  const chunkEntities: string[][] = chunks.map((chunk) =>
    detectEntities(chunk.text, options?.minEntityFrequency),
  )
  const allEntityNames = [...new Set(chunkEntities.flat())]
  const entityIndex = buildEntityIndex(allEntityNames)

  // Pass 2: build each zettel
  const zettels = chunks.map((chunk, i) => {
    const entities = chunkEntities[i] ?? []
    const topics = extractTopics(chunk.text, options?.minTopicFrequency, options?.stopWords)
    const quote = selectKeySentence(chunk.text)
    const flags = detectFlags(chunk.text)
    const emotions = detectEmotions(chunk.text)
    const weight = computeWeight(emotions, flags, chunk.text)

    return {
      id: String(i + 1).padStart(3, '0'),
      entities,
      topics,
      quote,
      weight,
      emotions,
      flags,
    }
  })

  normalizeWeights(zettels, options?.temperature)

  const tunnels = buildTunnels(
    zettels,
    entityIndex,
    options?.tunnelThreshold,
    options?.tunnelTopK,
  )

  return {
    zettels,
    tunnels,
    entityIndex,
    meta: Object.assign(
      { inputLength: text.length, chunkCount: chunks.length },
      options?.date !== undefined ? { date: options.date } : {},
      options?.title !== undefined ? { title: options.title } : {},
    ),
  }
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

  // Re-index zettel ids globally
  let globalIndex = 1
  const mergedZettels = results.flatMap((r) =>
    r.zettels.map((z) => ({ ...z, id: String(globalIndex++).padStart(3, '0') })),
  )

  // Per-result weights are on independent scales (single-chunk results carry
  // raw scores) — re-normalize over the merged set so filtering is consistent
  normalizeWeights(mergedZettels)

  const mergedTunnels = buildTunnels(mergedZettels, mergedIndex)

  const totalInput = results.reduce((sum, r) => sum + (r.meta?.inputLength ?? 0), 0)

  return {
    zettels: mergedZettels,
    tunnels: mergedTunnels,
    entityIndex: mergedIndex,
    meta: { inputLength: totalInput, chunkCount: mergedZettels.length },
  }
}

/** Whitespace-word token estimate — the same measure the budget enforces. */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.ceil(words * 1.3)
}

function markdownLine(z: Zettel): string {
  const emotionStr = z.emotions.length > 0 ? z.emotions.join(', ') : 'none'
  const flagStr = z.flags.length > 0 ? z.flags.join(', ') : 'none'
  return `**[${z.id}]** ${z.quote} *(${emotionStr} | ${flagStr} | weight: ${z.weight})*`
}

function tunnelsAmong(tunnels: Tunnel[], zettels: Zettel[]): Tunnel[] {
  const ids = new Set(zettels.map((z) => z.id))
  return tunnels.filter((t) => ids.has(t.from) && ids.has(t.to))
}

function renderOutput(
  result: CompressResult,
  zettels: Zettel[],
  format: 'aaak' | 'json' | 'markdown',
): string {
  const tunnels = tunnelsAmong(result.tunnels, zettels)
  if (format === 'json') return JSON.stringify({ zettels, tunnels }, null, 2)
  if (format === 'markdown') return zettels.map(markdownLine).join('\n\n')
  return encode({ ...result, zettels, tunnels })
}

// Greedy budget fit: zettels enter in weight order, each measured as it would
// actually render, and the budget is never exceeded. Tunnel lines (aaak/json)
// are added last with whatever budget remains.
function fitToBudget(
  result: CompressResult,
  candidates: Zettel[],
  format: 'aaak' | 'json' | 'markdown',
  budget: number,
): Zettel[] {
  const sorted = [...candidates].sort((a, b) => b.weight - a.weight)
  const selected: Zettel[] = []

  for (const z of sorted) {
    const attempt = renderOutput(result, [...selected, z], format)
    if (estimateTokens(attempt) > budget) break
    selected.push(z)
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
    zettels = [...zettels].sort((a, b) => b.weight - a.weight).slice(0, options.maxZettels)
  }

  const format = options?.format ?? 'aaak'

  // Budget is the final gate: measure real rendered output, never exceed
  if (options?.maxTokenBudget !== undefined) {
    zettels = fitToBudget(result, zettels, format, options.maxTokenBudget)
  }

  return renderOutput(result, zettels, format)
}

export { encode, decode } from './encoder.js'
export { wakeUp, topZettels } from './layer1.js'
export type {
  Zettel,
  Tunnel,
  EntityIndex,
  CompressResult,
  CompressOptions,
  InjectOptions,
  TextChunk,
  FlagName,
  EmotionName,
} from './types.js'
