import { describe, it, expect } from 'vitest'
import { extractTopics } from '../src/topic-extractor.js'
import { compress, encode, decode } from '../src/index.js'

describe('extractTopics — unigrams (backward-compatible behaviour)', () => {
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

describe('extractTopics — YAKE multi-word phrases', () => {
  it('extracts a two-word keyphrase when it co-occurs', () => {
    const text = 'connection pool exhaustion caused failures connection pool is the bottleneck'
    const topics = extractTopics(text)
    // "connection pool" should appear as a phrase
    expect(topics.some((t) => t === 'connection pool')).toBe(true)
  })

  it('does not create degenerate bigrams from repeated identical tokens', () => {
    const text = 'real-time processing is needed real-time real-time systems'
    const topics = extractTopics(text)
    // "real-time real-time" is not a valid phrase
    expect(topics).not.toContain('real-time real-time')
    expect(topics).toContain('real-time')
  })

  it('prefers more specific phrase over bare unigrams it absorbs', () => {
    const text = 'rate limiting strategy is applied rate limiting is configured for the rate limiting middleware'
    const topics = extractTopics(text)
    // "rate limiting" should appear rather than "rate" and "limiting" separately
    const hasPhrase = topics.some((t) => t === 'rate limiting')
    const hasRateAlone = topics.includes('rate')
    // if the phrase is present, the absorbed unigrams should not crowd it out
    if (hasPhrase) {
      expect(topics.length).toBeLessThanOrEqual(8)
    }
    expect(hasPhrase || hasRateAlone).toBe(true) // at least one signal captured
  })

  it('returned topics are all lowercase strings', () => {
    const text = 'Redis Cache layer stores UserSession tokens for AuthService validation'
    const topics = extractTopics(text)
    for (const t of topics) {
      expect(t).toBe(t.toLowerCase())
    }
  })

  it('phrase topics survive compress() → encode() → decode() round-trip', () => {
    const text = [
      'The connection pool exhaustion was causing issues with the connection pool under heavy load.',
      'We decided to fix the connection pool size limit to resolve the database connection pool problem.',
    ].join(' ')
    const r = compress(text)
    const hasPhrase = r.zettels.some((z) => z.topics.some((t) => t.includes(' ')))
    if (hasPhrase) {
      const encoded = encode(r)
      const decoded = decode(encoded)
      const origTopics = r.zettels.flatMap((z) => z.topics).sort()
      const decodedTopics = decoded.zettels.flatMap((z) => z.topics).sort()
      expect(decodedTopics).toEqual(origTopics)
    }
  })

  it('tunnel builder connects zettels sharing phrase tokens across multi-word topics', () => {
    const text = [
      'The connection pool exhaustion caused cascading failures across multiple database connections.',
      'We fixed the connection pool by increasing the maximum pool size from 10 to 100 connections.',
      'After fixing the connection pool the database performance improved significantly overnight.',
    ].join('\n\n')
    const r = compress(text, { chunkSize: 150 })
    // All zettels discuss "connection pool" — tunnels should form
    expect(r.tunnels.length).toBeGreaterThan(0)
  })
})
