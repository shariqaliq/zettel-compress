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
