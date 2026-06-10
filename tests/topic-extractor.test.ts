import { describe, it, expect } from 'vitest'
import { extractTopics } from '../src/topic-extractor.js'

describe('extractTopics', () => {
  it('returns empty array for stop-words-only text', () => {
    const result = extractTopics('the and is a for with by')
    expect(result).toEqual([])
  })

  it('boosts CamelCase terms to top', () => {
    const result = extractTopics('LangChain is a framework for building applications with LLMs and LangChain provides tools')
    expect(result[0]).toBe('langchain')
  })

  it('boosts ALL-CAPS terms', () => {
    const result = extractTopics('The API connects to the LLM service via the API endpoint using API keys')
    expect(result.slice(0, 3)).toContain('api')
  })

  it('strips stop words', () => {
    const topics = extractTopics('the quick brown fox jumps over the lazy dog the the the')
    for (const t of topics) {
      expect(['the', 'is', 'a', 'and', 'for', 'with']).not.toContain(t)
    }
  })

  it('returns at most 8 topics', () => {
    const text = Array.from({ length: 30 }, (_, i) => `topic${i} topic${i}`).join(' ')
    const result = extractTopics(text)
    expect(result.length).toBeLessThanOrEqual(8)
  })

  it('returns empty for empty string', () => {
    expect(extractTopics('')).toEqual([])
  })

  it('boosts hyphenated terms', () => {
    const result = extractTopics('real-time processing is needed real-time real-time systems')
    expect(result).toContain('real-time')
  })

  it('accepts extra stop words', () => {
    const result = extractTopics('framework framework framework', 1, ['framework'])
    expect(result).not.toContain('framework')
  })

  it('respects minFreq threshold', () => {
    const result = extractTopics('unique rare word but common common common common', 3)
    expect(result).toContain('common')
    expect(result).not.toContain('unique')
    expect(result).not.toContain('rare')
  })
})
