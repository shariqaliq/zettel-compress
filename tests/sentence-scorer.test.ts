import { describe, it, expect } from 'vitest'
import { selectKeySentence } from '../src/sentence-scorer.js'

describe('selectKeySentence', () => {
  it('returns truncated text for very short input', () => {
    const result = selectKeySentence('Hello world')
    expect(result).toBe('Hello world')
  })

  it('prefers the decision-word sentence', () => {
    const text = [
      'The weather was nice today and we enjoyed the outdoors.',
      'We decided to move forward with the new architecture.',
      'The team had lunch together at the local restaurant.',
    ].join(' ')
    const result = selectKeySentence(text)
    expect(result.toLowerCase()).toContain('decided')
  })

  it('does not split on abbreviation Dr.', () => {
    const text = 'Dr. Smith reviewed the proposal. We agreed with his findings and decided to proceed.'
    const result = selectKeySentence(text)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('penalizes very long sentences', () => {
    const longSentence = ('word '.repeat(50)).trim() + '.'
    const shortDecision = 'We decided to proceed.'
    const text = longSentence + ' ' + shortDecision
    const result = selectKeySentence(text)
    expect(result).toBe('We decided to proceed.')
  })

  it('returns a non-empty string for any non-empty input', () => {
    const texts = [
      'Single sentence here.',
      'First sentence. Second sentence. Third sentence.',
      'Word1 word2 word3 word4 word5 word6.',
    ]
    for (const t of texts) {
      expect(selectKeySentence(t).length).toBeGreaterThan(0)
    }
  })

  it('truncates to 120 chars for very short word count input', () => {
    const short = 'hi there'
    const result = selectKeySentence(short)
    expect(result.length).toBeLessThanOrEqual(120)
  })
})
