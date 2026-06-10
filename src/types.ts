export type FlagName =
  | 'DECISION'
  | 'ORIGIN'
  | 'CORE'
  | 'PIVOT'
  | 'GENESIS'
  | 'TECHNICAL'

export type EmotionName =
  | 'conviction'
  | 'grief'
  | 'joy'
  | 'fear'
  | 'hope'
  | 'trust'
  | 'wonder'
  | 'rage'
  | 'exhaustion'
  | 'shame'
  | 'pride'
  | 'nostalgia'
  | 'anxiety'
  | 'relief'
  | 'anticipation'
  | 'frustration'
  | 'gratitude'
  | 'loneliness'
  | 'inspiration'
  | 'confusion'
  | 'clarity'
  | 'guilt'
  | 'awe'
  | 'regret'
  | 'determination'
  | 'vulnerability'
  | 'acceptance'
  | 'resistance'
  | 'love'
  | 'loss'

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
  }
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
  /** Hard token budget — stops adding zettels once estimated token count is reached */
  maxTokenBudget?: number
}

export interface TextChunk {
  text: string
  index: number
  charStart: number
  charEnd: number
}
