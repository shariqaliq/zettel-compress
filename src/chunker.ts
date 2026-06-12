import type { TextChunk, CompressOptions } from './types.js'

const DEFAULT_CHUNK_SIZE = 800
const DEFAULT_CHUNK_OVERLAP = 100

/** Line-ending normalization all offsets are relative to. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

interface ParaSpan {
  start: number
  end: number
}

function pushPara(paras: ParaSpan[], s: string, from: number, to: number): void {
  let start = from
  let end = to
  while (start < end && /\s/.test(s[start] ?? '')) start++
  while (end > start && /\s/.test(s[end - 1] ?? '')) end--
  if (end > start) paras.push({ start, end })
}

// Pick where the next chunk begins inside the previous one. The raw slice
// point can land mid-word, which would hand a fragment to the sentence
// scorer — snap forward to the next word start instead.
function overlapStart(
  s: string,
  prevStart: number,
  prevEnd: number,
  overlap: number,
  nextParaStart: number,
): number {
  if (overlap <= 0) return nextParaStart
  let candidate = Math.max(prevStart, prevEnd - overlap)
  if (candidate === prevStart) return candidate

  if (/\S/.test(s[candidate - 1] ?? ' ')) {
    while (candidate < prevEnd && /\S/.test(s[candidate] ?? ' ')) candidate++
  }
  while (candidate < prevEnd && /\s/.test(s[candidate] ?? '')) candidate++

  return candidate < prevEnd ? candidate : nextParaStart
}

function makeChunk(s: string, start: number, end: number, index: number): TextChunk {
  return { text: s.slice(start, end), index, charStart: start, charEnd: end }
}

export function chunkText(
  text: string,
  options?: Pick<CompressOptions, 'chunkSize' | 'chunkOverlap'>,
): TextChunk[] {
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE
  const chunkOverlap = options?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP

  const normalized = normalizeText(text)
  if (normalized.trim().length === 0) return []

  // Paragraph spans carry real offsets into the normalized text, so
  // chunk.text === normalized.slice(charStart, charEnd) holds for every
  // chunk — including overlap seeds, which are contiguous with the
  // paragraph that follows them in the source
  const paras: ParaSpan[] = []
  const sep = /\n{2,}/g
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = sep.exec(normalized)) !== null) {
    pushPara(paras, normalized, cursor, m.index)
    cursor = m.index + m[0].length
  }
  pushPara(paras, normalized, cursor, normalized.length)

  const chunks: TextChunk[] = []
  let chunkStart = -1
  let chunkEnd = -1

  for (const p of paras) {
    if (chunkStart === -1) {
      chunkStart = p.start
      chunkEnd = p.end
      continue
    }
    if (p.end - chunkStart > chunkSize) {
      chunks.push(makeChunk(normalized, chunkStart, chunkEnd, chunks.length))
      chunkStart = overlapStart(normalized, chunkStart, chunkEnd, chunkOverlap, p.start)
    }
    chunkEnd = p.end
  }

  if (chunkStart !== -1) {
    chunks.push(makeChunk(normalized, chunkStart, chunkEnd, chunks.length))
  }

  return chunks
}
