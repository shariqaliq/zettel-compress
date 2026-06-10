type FlagName = 'DECISION' | 'ORIGIN' | 'CORE' | 'PIVOT' | 'GENESIS' | 'TECHNICAL';
type EmotionName = 'conviction' | 'grief' | 'joy' | 'fear' | 'hope' | 'trust' | 'wonder' | 'rage' | 'exhaustion' | 'shame' | 'pride' | 'nostalgia' | 'anxiety' | 'relief' | 'anticipation' | 'frustration' | 'gratitude' | 'loneliness' | 'inspiration' | 'confusion' | 'clarity' | 'guilt' | 'awe' | 'regret' | 'determination' | 'vulnerability' | 'acceptance' | 'resistance' | 'love' | 'loss';
interface Zettel {
    id: string;
    entities: string[];
    topics: string[];
    quote: string;
    weight: number;
    emotions: EmotionName[];
    flags: FlagName[];
}
interface Tunnel {
    from: string;
    to: string;
    label: string;
}
interface EntityIndex {
    nameToCode: Record<string, string>;
    codeToName: Record<string, string>;
}
interface CompressResult {
    zettels: Zettel[];
    tunnels: Tunnel[];
    entityIndex: EntityIndex;
    meta?: {
        inputLength: number;
        chunkCount: number;
        date?: string;
        title?: string;
    };
}
interface CompressOptions {
    chunkSize?: number;
    chunkOverlap?: number;
    date?: string;
    title?: string;
    minEntityFrequency?: number;
    minTopicFrequency?: number;
    stopWords?: string[];
}
interface InjectOptions {
    maxZettels?: number;
    minWeight?: number;
    flags?: FlagName[];
    format?: 'aaak' | 'json' | 'markdown';
}
interface TextChunk {
    text: string;
    index: number;
    charStart: number;
    charEnd: number;
}

declare function encode(result: CompressResult): string;
declare function decode(aaak: string): CompressResult;

declare function wakeUp(result: CompressResult): string;
declare function topZettels(result: CompressResult, n: number): Zettel[];

declare function compress(text: string, options?: CompressOptions): CompressResult;
declare function compressMany(texts: string[], options?: CompressOptions): CompressResult[];
declare function mergeResults(results: CompressResult[]): CompressResult;
declare function injectContext(result: CompressResult, options?: InjectOptions): string;

export { type CompressOptions, type CompressResult, type EmotionName, type EntityIndex, type FlagName, type InjectOptions, type TextChunk, type Tunnel, type Zettel, compress, compressMany, decode, encode, injectContext, mergeResults, topZettels, wakeUp };
