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
}

export interface InjectOptions {
  maxZettels?: number
  minWeight?: number
  flags?: FlagName[]
  format?: 'aaak' | 'json' | 'markdown'
}

export interface TextChunk {
  text: string
  index: number
  charStart: number
  charEnd: number
}
