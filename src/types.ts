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
  /** Start offset of the source chunk in the normalized input text */
  sourceStart?: number
  /** End offset of the source chunk in the normalized input text */
  sourceEnd?: number
  /**
   * ISO-8601 date string (YYYY-MM-DD or YYYY-MM or YYYY) resolved from the
   * chunk text. Absolute dates are taken directly; relative expressions
   * ("yesterday", "last week") are resolved against the nearest preceding
   * absolute date anchor in the text, then against CompressOptions.date.
   */
  resolvedDate?: string
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

export interface Contradiction {
  /** Earlier (superseded) zettel id */
  earlier: string
  /** Later (superseding) zettel id */
  later: string
  /** Shared entity or topic that links the two zettels */
  sharedTopic: string
  /** What kind of conflict signal fired */
  signal: 'negation-flip' | 'value-change' | 'antonym'
  /** One-line human-readable summary */
  summary: string
}

export interface CompressResult {
  zettels: Zettel[]
  tunnels: Tunnel[]
  entityIndex: EntityIndex
  /** Detected contradictions between DECISION-flagged zettels across chunks */
  contradictions?: Contradiction[]
  meta?: {
    inputLength: number
    chunkCount: number
    date?: string
    title?: string
    /** Non-fatal problems found while decoding (malformed lines, unknown tokens) */
    warnings?: string[]
    /**
     * Normalized input text — zettel source offsets index into this. Kept in
     * memory for provenance-expanded recall; never serialized into AAAK.
     */
    source?: string
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
  /**
   * Merge near-duplicate zettels (repeated boilerplate, re-sent messages).
   * The highest-weight copy survives and absorbs the others' entities,
   * topics, emotions, and flags (default false).
   */
  dedupe?: boolean
  /** Token-set Jaccard similarity at which zettels count as duplicates (default 0.9) */
  dedupeThreshold?: number
  /** Use entity names in tunnel labels (Alice+Bob) instead of codes (ALC+BBB) */
  verboseLabels?: boolean
  /**
   * Keep the normalized input text on meta.source so recallContext() can
   * return full source passages instead of single quotes (default true).
   * Set false to minimize the in-memory result size.
   */
  keepSource?: boolean
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
  /**
   * Exact token counter for budget enforcement (e.g. a js-tiktoken encode
   * length). Defaults to the built-in estimate.
   */
  countTokens?: (text: string) => number
}

export interface TextChunk {
  text: string
  index: number
  charStart: number
  charEnd: number
}
