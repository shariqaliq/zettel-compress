export const ALL_FLAGS = [
  'DECISION',
  'ORIGIN',
  'CORE',
  'PIVOT',
  'GENESIS',
  'TECHNICAL',
] as const

export type FlagName = (typeof ALL_FLAGS)[number]

export const ALL_EMOTIONS = [
  'conviction',
  'grief',
  'joy',
  'fear',
  'hope',
  'trust',
  'wonder',
  'rage',
  'exhaustion',
  'shame',
  'pride',
  'nostalgia',
  'anxiety',
  'relief',
  'anticipation',
  'frustration',
  'gratitude',
  'loneliness',
  'inspiration',
  'confusion',
  'clarity',
  'guilt',
  'awe',
  'regret',
  'determination',
  'vulnerability',
  'acceptance',
  'resistance',
  'love',
  'loss',
] as const

export type EmotionName = (typeof ALL_EMOTIONS)[number]

export interface Zettel {
  id: string
  entities: string[]
  topics: string[]
  quote: string
  weight: number
  emotions: EmotionName[]
  flags: FlagName[]
}

export interface Tunnel {
  from: string
  to: string
  label: string
}

export interface EntityIndex {
  nameToCode: Record<string, string>
  codeToName: Record<string, string>
}

export interface CompressResult {
  zettels: Zettel[]
  tunnels: Tunnel[]
  entityIndex: EntityIndex
  meta?: {
    inputLength: number
    chunkCount: number
    date?: string
    title?: string
    /** Non-fatal problems found while decoding (malformed lines, unknown tokens) */
    warnings?: string[]
  }
}

export interface DecodeOptions {
  /** Throw on malformed lines instead of skipping them with a warning */
  strict?: boolean
}

export interface CompressOptions {
  chunkSize?: number
  chunkOverlap?: number
  date?: string
  title?: string
  minEntityFrequency?: number
  minTopicFrequency?: number
  stopWords?: string[]
  /** Softmax temperature for weight normalization. Lower = sharper separation (default 0.5) */
  temperature?: number
  /** Max tunnels per zettel — prevents O(n²) explosion on large docs (default 3) */
  tunnelTopK?: number
  /** Minimum Jaccard similarity score to emit a tunnel (default 0.3) */
  tunnelThreshold?: number
}

export interface InjectOptions {
  maxZettels?: number
  minWeight?: number
  flags?: FlagName[]
  format?: 'aaak' | 'json' | 'markdown'
  /** Hard token budget — output is measured as rendered and never exceeds it */
  maxTokenBudget?: number
  /**
   * Selection strategy when maxZettels limits the set.
   * 'weight' (default): rank by 0.7·weight + 0.3·signal-flag bonus.
   * 'mmr': maximal marginal relevance — the same ranking traded against
   * similarity to already-selected zettels, so near-duplicates don't crowd
   * out distinct signals.
   */
  selection?: 'weight' | 'mmr'
  /**
   * Always include at least one zettel per listed flag if one exists in the
   * result — even if filters or ranking would have excluded it.
   */
  guaranteeFlags?: FlagName[]
}

export interface TextChunk {
  text: string
  index: number
  charStart: number
  charEnd: number
}
