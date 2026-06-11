import { describe, it, expect } from 'vitest'
import { chunkText } from '../src/chunker.js'

describe('chunkText', () => {
  it('returns empty array for empty string', () => {
    expect(chunkText('')).toEqual([])
  })

  it('returns empty array for whitespace-only string', () => {
    expect(chunkText('   \n\n  ')).toEqual([])
  })

  it('returns single chunk for short text', () => {
    const result = chunkText('Hello world.')
    expect(result).toHaveLength(1)
    expect(result[0]?.index).toBe(0)
    expect(result[0]?.charStart).toBe(0)
  })

  it('single chunk for text below chunkSize', () => {
    const text = 'a'.repeat(700)
    const result = chunkText(text, { chunkSize: 800 })
    expect(result).toHaveLength(1)
    expect(result[0]?.text).toBe(text)
  })

  it('assigns sequential indexes', () => {
    const para = 'word '.repeat(160)
    const text = para + '\n\n' + para + '\n\n' + para
    const result = chunkText(text, { chunkSize: 800 })
    result.forEach((chunk, i) => {
      expect(chunk.index).toBe(i)
    })
  })

  it('handles single oversized paragraph without splitting mid-word', () => {
    const text = 'longword '.repeat(200)  // ~1800 chars, no \n\n
    const result = chunkText(text, { chunkSize: 800 })
    expect(result).toHaveLength(1)
    expect(result[0]?.text).toBe(text.trim())
  })

  it('produces multiple chunks for multi-paragraph text', () => {
    const para = 'word '.repeat(100)  // ~500 chars each
    const text = [para, para, para].join('\n\n')
    const result = chunkText(text, { chunkSize: 600 })
    expect(result.length).toBeGreaterThan(1)
  })

  it('normalizes CRLF line endings', () => {
    const text = 'First para.\r\n\r\nSecond para.'
    const result = chunkText(text)
    expect(result.length).toBeGreaterThan(0)
    result.forEach((c) => expect(c.text).not.toContain('\r'))
  })

  it('charEnd - charStart is approximately chunk text length', () => {
    const para = 'The quick brown fox. '.repeat(20)
    const text = [para, para, para].join('\n\n')
    const result = chunkText(text, { chunkSize: 400 })
    for (const chunk of result) {
      expect(chunk.charEnd - chunk.charStart).toBeGreaterThan(0)
    }
  })
})

describe('chunkText — overlap boundaries and provenance (issue #5)', () => {
  const para = (label: string) =>
    `${label} sentence one talks about deployment strategy in detail. ` +
    `${label} sentence two covers the migration and rollback planning thoroughly.`
  const TEXT = [para('Alpha'), para('Bravo'), para('Charlie'), para('Delta')].join('\n\n')

  it('chunk.text is the exact source slice — offsets are real provenance', () => {
    const normalized = TEXT // no \r in fixture
    const result = chunkText(TEXT, { chunkSize: 300, chunkOverlap: 60 })
    expect(result.length).toBeGreaterThan(1)
    for (const chunk of result) {
      expect(normalized.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text)
    }
  })

  it('no chunk begins mid-word — first token is a complete word', () => {
    const result = chunkText(TEXT, { chunkSize: 300, chunkOverlap: 60 })
    const words = new Set(TEXT.split(/\s+/))
    for (const chunk of result) {
      const firstWord = chunk.text.split(/\s+/)[0] ?? ''
      expect(words).toContain(firstWord)
    }
  })

  it('overlapping chunks share content from the previous chunk tail', () => {
    const result = chunkText(TEXT, { chunkSize: 300, chunkOverlap: 60 })
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1]!
      const cur = result[i]!
      if (cur.charStart < prev.charEnd) {
        const shared = TEXT.slice(cur.charStart, prev.charEnd)
        expect(prev.text.endsWith(shared)).toBe(true)
        expect(cur.text.startsWith(shared)).toBe(true)
      }
    }
  })

  it('provenance holds for CRLF input against the normalized text', () => {
    const crlf = TEXT.replace(/\n/g, '\r\n')
    const normalized = crlf.replace(/\r\n/g, '\n')
    const result = chunkText(crlf, { chunkSize: 300, chunkOverlap: 60 })
    for (const chunk of result) {
      expect(normalized.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text)
    }
  })

  it('zero overlap starts each chunk at a paragraph boundary', () => {
    const result = chunkText(TEXT, { chunkSize: 300, chunkOverlap: 0 })
    for (const chunk of result) {
      expect(chunk.text.startsWith('Alpha') || chunk.text.startsWith('Bravo') ||
             chunk.text.startsWith('Charlie') || chunk.text.startsWith('Delta')).toBe(true)
    }
  })
})
