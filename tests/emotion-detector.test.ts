import { describe, it, expect } from 'vitest'
import { detectEmotions, computeWeight } from '../src/emotion-detector.js'

describe('detectEmotions', () => {
  it('detects conviction from decision keyword', () => {
    const result = detectEmotions('I decided to commit to this path.')
    expect(result).toContain('conviction')
  })

  it('detects grief from loss keyword', () => {
    const result = detectEmotions('I lost my grandmother last week.')
    expect(result).toContain('grief')
  })

  it('returns empty array for neutral text', () => {
    const result = detectEmotions('The function returns a string value.')
    expect(result).toEqual([])
  })

  it('detects multiple emotions', () => {
    const text = 'I was afraid but decided to move forward with hope.'
    const result = detectEmotions(text)
    expect(result).toContain('fear')
    expect(result).toContain('conviction')
    expect(result).toContain('hope')
  })

  it('is case-insensitive', () => {
    expect(detectEmotions('I DECIDED to go.')).toContain('conviction')
    expect(detectEmotions('I Am AFRAID.')).toContain('fear')
  })

  it('detects exhaustion', () => {
    expect(detectEmotions('I am completely burnt out and exhausted.')).toContain('exhaustion')
  })

  it('detects joy', () => {
    expect(detectEmotions('I am so happy and thrilled about this!')).toContain('joy')
  })

  it('suppresses fear when negated — "not afraid"', () => {
    expect(detectEmotions('I am not afraid of this challenge.')).not.toContain('fear')
  })

  it('suppresses conviction when negated — "never decided"', () => {
    expect(detectEmotions('We never decided to move forward.')).not.toContain('conviction')
  })

  it('suppresses joy when negated — "hardly happy"', () => {
    expect(detectEmotions('She was hardly happy about the outcome.')).not.toContain('joy')
  })

  it('still detects emotion when negation is far away (> 4 words before keyword)', () => {
    expect(detectEmotions('Not everything went wrong but Alice was genuinely afraid of the result.')).toContain('fear')
  })
})

describe('computeWeight', () => {
  it('returns 0 for empty emotions and flags and no decision words', () => {
    const weight = computeWeight([], [], 'the cat sat on the mat')
    expect(weight).toBe(0)
  })

  it('increases with flag count', () => {
    const w1 = computeWeight([], ['DECISION'], 'something')
    const w2 = computeWeight([], ['DECISION', 'CORE'], 'something')
    expect(w2).toBeGreaterThan(w1)
  })

  it('increases with emotion count', () => {
    const w1 = computeWeight(['joy'], [], 'text')
    const w2 = computeWeight(['joy', 'hope', 'conviction'], [], 'text')
    expect(w2).toBeGreaterThan(w1)
  })

  it('never exceeds 1.0', () => {
    const weight = computeWeight(
      ['joy', 'grief', 'fear', 'hope', 'trust', 'rage'],
      ['DECISION', 'CORE', 'ORIGIN', 'PIVOT', 'GENESIS'],
      'decided committed resolved determined',
    )
    expect(weight).toBeLessThanOrEqual(1.0)
  })

  it('always returns exactly 2 decimal places', () => {
    const w = computeWeight(['conviction'], ['DECISION'], 'decided to go')
    expect(String(w)).toMatch(/^\d+\.\d{2}$/)
  })

  it('factors in decision word density', () => {
    const sparse = computeWeight([], [], 'the cat sat decided on the long mat with stuff here')
    const dense = computeWeight([], [], 'decided committed resolved must will determined')
    expect(dense).toBeGreaterThan(sparse)
  })

  it('caps flag contribution at 0.9', () => {
    const w = computeWeight([], ['DECISION', 'CORE', 'ORIGIN', 'PIVOT', 'GENESIS', 'TECHNICAL'], 'text')
    expect(w).toBeLessThanOrEqual(1.0)
  })
})
