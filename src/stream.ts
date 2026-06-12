import { chunkText } from './chunker.js'
import { detectEntities, extendEntityIndex } from './entity-detector.js'
import { resolveCoreferences } from './coreference.js'
import { extractTopics } from './topic-extractor.js'
import { selectKeySentence } from './sentence-scorer.js'
import { detectEmotions, computeWeight } from './emotion-detector.js'
import { detectFlags } from './flag-detector.js'
import { buildTunnels } from './tunnel-builder.js'
import { dedupeTokens } from './dedupe.js'
import { exactJaccard } from './minhash.js'
import { normalizeWeights, blendCentrality } from './index.js'
import { recall } from './recall.js'
import type { RecallOptions } from './recall.js'
import type {
  CompressOptions,
  CompressResult,
  EntityIndex,
  TextChunk,
  Zettel,
} from './types.js'

export interface StreamOptions extends CompressOptions {
  /**
   * Recency half-life measured in pushes: a zettel's raw weight halves every
   * N pushes when ranking and evicting. Omit for no decay.
   */
  halfLifeTurns?: number
  /**
   * Hard cap on retained zettels. When exceeded, the lowest decayed-weight
   * zettels are evicted (oldest first on ties), so memory stays bounded no
   * matter how long the stream runs.
   */
  maxZettels?: number
}

interface StreamZettel extends Zettel {
  /** push number that produced this zettel (for decay) */
  turn: number
  /** raw, un-normalized weight from detection */
  rawWeight: number
  /** dedup token set — only populated when options.dedupe is on */
  tokens?: Set<string>
}

/**
 * Incremental compression for message streams. Each push() compresses one
 * message into zettels immediately; snapshot() returns a CompressResult at
 * any point. Entity codes never change once assigned, decay is deterministic
 * in push counts (not wall clock), and the whole state is a pure function of
 * the pushed messages — replaying the same messages reproduces the same
 * snapshot byte for byte.
 */
export class CompressStream {
  private readonly options: StreamOptions
  private readonly entityIndex: EntityIndex = { nameToCode: {}, codeToName: {} }
  private readonly zettels: StreamZettel[] = []
  private turn = 0
  private idCounter = 0
  private totalInput = 0
  private recentEntities: string[] = []

  constructor(options?: StreamOptions) {
    this.options = options ?? {}
  }

  get size(): number {
    return this.zettels.length
  }

  push(text: string): void {
    this.turn++
    this.totalInput += text.length
    const chunks = chunkText(text, this.options)
    if (chunks.length === 0) return

    const detected = chunks.map((c) => detectEntities(c.text, this.options.minEntityFrequency))

    // Seed coreference with the stream's recent entities, so a pronoun in
    // this message can bind to a name mentioned in an earlier message
    const seedChunk: TextChunk = { text: '', index: -1, charStart: 0, charEnd: 0 }
    const resolved = resolveCoreferences(
      [seedChunk, ...chunks],
      [this.recentEntities, ...detected],
    ).slice(1)

    const newNames = [...new Set(resolved.flat())]
    extendEntityIndex(this.entityIndex, newNames)

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!
      const entities = resolved[i] ?? []
      const flags = detectFlags(chunk.text)
      const emotions = detectEmotions(chunk.text)

      const candidate: StreamZettel = {
        id: String(this.idCounter + 1).padStart(3, '0'),
        entities,
        topics: extractTopics(chunk.text, this.options.minTopicFrequency, this.options.stopWords),
        quote: selectKeySentence(chunk.text),
        weight: 0, // normalized at snapshot time
        rawWeight: computeWeight(emotions, flags, chunk.text),
        emotions,
        flags,
        turn: this.turn,
      }

      // A near-duplicate of an existing zettel refreshes that zettel's
      // recency and absorbs new metadata instead of growing the stream —
      // repetition strengthens a memory rather than copying it
      if (this.options.dedupe && this.absorbDuplicate(candidate)) continue

      this.idCounter++
      candidate.id = String(this.idCounter).padStart(3, '0')
      this.zettels.push(candidate)

      for (const name of entities) {
        const idx = this.recentEntities.indexOf(name)
        if (idx !== -1) this.recentEntities.splice(idx, 1)
        this.recentEntities.push(name)
      }
    }
    this.recentEntities = this.recentEntities.slice(-8)

    this.evict()
  }

  private absorbDuplicate(candidate: StreamZettel): boolean {
    const threshold = this.options.dedupeThreshold ?? 0.9
    candidate.tokens = dedupeTokens(candidate)
    for (const existing of this.zettels) {
      existing.tokens ??= dedupeTokens(existing)
      if (exactJaccard(candidate.tokens, existing.tokens) >= threshold) {
        existing.turn = this.turn // refresh recency
        if (candidate.rawWeight > existing.rawWeight) existing.rawWeight = candidate.rawWeight
        existing.entities = [...new Set([...existing.entities, ...candidate.entities])].sort()
        existing.topics = [...new Set([...existing.topics, ...candidate.topics])]
        for (const e of candidate.emotions) {
          if (!existing.emotions.includes(e)) existing.emotions.push(e)
        }
        for (const f of candidate.flags) {
          if (!existing.flags.includes(f)) existing.flags.push(f)
        }
        delete existing.tokens // merged fields changed — recompute lazily
        return true
      }
    }
    return false
  }

  private decayedWeight(z: StreamZettel): number {
    const halfLife = this.options.halfLifeTurns
    if (halfLife === undefined || halfLife <= 0) return z.rawWeight
    return z.rawWeight * Math.pow(0.5, (this.turn - z.turn) / halfLife)
  }

  private evict(): void {
    const cap = this.options.maxZettels
    if (cap === undefined || this.zettels.length <= cap) return
    const ranked = [...this.zettels].sort(
      (a, b) =>
        this.decayedWeight(a) - this.decayedWeight(b) ||
        a.turn - b.turn ||
        a.id.localeCompare(b.id),
    )
    const evict = new Set(ranked.slice(0, this.zettels.length - cap).map((z) => z.id))
    for (let i = this.zettels.length - 1; i >= 0; i--) {
      if (evict.has(this.zettels[i]!.id)) this.zettels.splice(i, 1)
    }
  }

  snapshot(): CompressResult {
    const zettels: Zettel[] = this.zettels.map((z) => ({
      id: z.id,
      entities: [...z.entities],
      topics: [...z.topics],
      quote: z.quote,
      weight: Math.round(this.decayedWeight(z) * 100) / 100,
      emotions: [...z.emotions],
      flags: [...z.flags],
    }))
    const tunnels = buildTunnels(
      zettels,
      this.entityIndex,
      this.options.tunnelThreshold,
      this.options.tunnelTopK,
      this.options.verboseLabels,
    )
    blendCentrality(zettels, tunnels)
    normalizeWeights(zettels, this.options.temperature)

    return {
      zettels,
      tunnels,
      entityIndex: {
        nameToCode: { ...this.entityIndex.nameToCode },
        codeToName: { ...this.entityIndex.codeToName },
      },
      meta: Object.assign(
        { inputLength: this.totalInput, chunkCount: zettels.length },
        this.options.date !== undefined ? { date: this.options.date } : {},
        this.options.title !== undefined ? { title: this.options.title } : {},
      ),
    }
  }

  recall(query: string, options?: RecallOptions): Zettel[] {
    return recall(this.snapshot(), query, options)
  }
}
