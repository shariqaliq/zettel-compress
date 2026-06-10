import { chunkText } from './chunker.js'
import { detectEntities, buildEntityIndex } from './entity-detector.js'
import { extractTopics } from './topic-extractor.js'
import { selectKeySentence } from './sentence-scorer.js'
import { detectEmotions, computeWeight } from './emotion-detector.js'
import { detectFlags } from './flag-detector.js'
import { buildTunnels } from './tunnel-builder.js'
import { encode, decode } from './encoder.js'
import { wakeUp, topZettels } from './layer1.js'
import type { CompressResult, CompressOptions, InjectOptions } from './types.js'

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

  const tunnels = buildTunnels(zettels, entityIndex)

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

  const mergedTunnels = buildTunnels(mergedZettels, mergedIndex)

  const totalInput = results.reduce((sum, r) => sum + (r.meta?.inputLength ?? 0), 0)

  return {
    zettels: mergedZettels,
    tunnels: mergedTunnels,
    entityIndex: mergedIndex,
    meta: { inputLength: totalInput, chunkCount: mergedZettels.length },
  }
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

  if (format === 'json') {
    return JSON.stringify({ zettels, tunnels: result.tunnels }, null, 2)
  }

  if (format === 'markdown') {
    return zettels
      .map((z) => {
        const emotionStr = z.emotions.length > 0 ? z.emotions.join(', ') : 'none'
        const flagStr = z.flags.length > 0 ? z.flags.join(', ') : 'none'
        return `**[${z.id}]** ${z.quote} *(${emotionStr} | ${flagStr} | weight: ${z.weight})*`
      })
      .join('\n\n')
  }

  return encode({ ...result, zettels })
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
