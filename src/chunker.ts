import type { TextChunk, CompressOptions } from './types.js'

const DEFAULT_CHUNK_SIZE = 800
const DEFAULT_CHUNK_OVERLAP = 100

export function chunkText(
  text: string,
  options?: Pick<CompressOptions, 'chunkSize' | 'chunkOverlap'>,
): TextChunk[] {
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE
  const chunkOverlap = options?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const trimmed = normalized.trim()
  if (trimmed.length === 0) return []

  const paragraphs = trimmed.split(/\n\n+/)
  const chunks: TextChunk[] = []

  let currentParagraphs: string[] = []
  let currentLength = 0
  let charCursor = 0
  let chunkIndex = 0

  const emitChunk = (paras: string[], start: number) => {
    const chunkText = paras.join('\n\n')
    chunks.push({
      text: chunkText,
      index: chunkIndex++,
      charStart: start,
      charEnd: start + chunkText.length,
    })
  }

  for (const para of paragraphs) {
    const paraLen = para.length + 2 // +2 for \n\n separator

    if (currentLength > 0 && currentLength + paraLen > chunkSize) {
      const chunkStart = charCursor - currentLength
      emitChunk(currentParagraphs, chunkStart)

      // seed next chunk with overlap from the tail of current chunk
      const combined = currentParagraphs.join('\n\n')
      const overlapText = combined.slice(-chunkOverlap)
      // find the first paragraph boundary within the overlap
      const boundaryIdx = overlapText.indexOf('\n\n')
      const overlapSeed =
        boundaryIdx !== -1 ? overlapText.slice(boundaryIdx + 2) : overlapText

      currentParagraphs = overlapSeed.length > 0 ? [overlapSeed] : []
      currentLength = overlapSeed.length
    }

    currentParagraphs.push(para)
    currentLength += paraLen
    charCursor += paraLen
  }

  if (currentParagraphs.length > 0) {
    const chunkStart = Math.max(0, charCursor - currentLength)
    emitChunk(currentParagraphs, chunkStart)
  }

  return chunks
}
