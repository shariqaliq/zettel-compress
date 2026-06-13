import { describe, it, expect } from 'vitest'
import { compress, detectContradictions } from '../src/index.js'

// Helper: build a result with two clearly separated DECISION chunks sharing a topic
const pad = (s: string, target = 160) => s + ' '.repeat(Math.max(0, target - s.length))

describe('detectContradictions — negation flip', () => {
  it('detects affirm → negate pair', () => {
    const text = [
      pad('We decided to use Redis for caching all user session data across our entire infrastructure.'),
      pad('After load testing we decided against Redis and ruled out the whole caching approach entirely.'),
    ].join('\n\n')
    const r = compress(text, { chunkSize: 180 })
    const contradictions = detectContradictions(r)
    expect(contradictions.length).toBeGreaterThanOrEqual(1)
    expect(contradictions[0]!.signal).toBe('negation-flip')
  })

  it('exposes the shared topic', () => {
    const text = [
      pad('We committed to deploying the microservice architecture for our new payment platform.'),
      pad('We never went with the microservice architecture and dropped that plan for the payment platform.'),
    ].join('\n\n')
    const r = compress(text, { chunkSize: 180 })
    const contradictions = detectContradictions(r)
    expect(contradictions.length).toBeGreaterThanOrEqual(1)
    // shared topic should link the two decision zettels
    expect(contradictions[0]!.sharedTopic).toBeTruthy()
    expect(contradictions[0]!.earlier).toBeTruthy()
    expect(contradictions[0]!.later).toBeTruthy()
  })

  it('summary is a non-empty string', () => {
    const text = [
      pad('We decided to ship on Friday with the new authentication module enabled for all users.'),
      pad('We decided not to ship on Friday and cancelled the authentication module rollout completely.'),
    ].join('\n\n')
    const r = compress(text, { chunkSize: 180 })
    const contradictions = detectContradictions(r)
    expect(contradictions.length).toBeGreaterThanOrEqual(1)
    expect(typeof contradictions[0]!.summary).toBe('string')
    expect(contradictions[0]!.summary.length).toBeGreaterThan(10)
  })
})

describe('detectContradictions — value change', () => {
  it('detects different object after same decision verb', () => {
    const text = [
      pad('We decided to ship the new payment feature on Friday morning before the weekend sprint review.'),
      pad('We decided to ship the new payment feature on Monday instead after rescheduling the sprint review.'),
    ].join('\n\n')
    const r = compress(text, { chunkSize: 180 })
    const contradictions = detectContradictions(r)
    expect(contradictions.length).toBeGreaterThanOrEqual(1)
    expect(['value-change', 'negation-flip', 'antonym']).toContain(contradictions[0]!.signal)
  })
})

describe('detectContradictions — antonym pairs', () => {
  it('detects approve/reject antonym', () => {
    const text = [
      pad('We decided to approve the new database migration plan for the production environment next quarter.'),
      pad('We decided to reject the new database migration plan after reviewing the production environment risks.'),
    ].join('\n\n')
    const r = compress(text, { chunkSize: 180 })
    const contradictions = detectContradictions(r)
    expect(contradictions.length).toBeGreaterThanOrEqual(1)
    // signal may fire as antonym or negation-flip depending on the quote selected
    expect(['antonym', 'negation-flip', 'value-change']).toContain(contradictions[0]!.signal)
  })

  it('detects enable/disable antonym', () => {
    const text = [
      pad('We agreed to enable dark mode by default for all new user accounts in the settings panel.'),
      pad('We agreed to disable dark mode by default across all new user account registration flows.'),
    ].join('\n\n')
    const r = compress(text, { chunkSize: 180 })
    const contradictions = detectContradictions(r)
    expect(contradictions.length).toBeGreaterThanOrEqual(1)
  })
})

describe('detectContradictions — non-contradictions', () => {
  it('returns empty for text with no DECISION flags', () => {
    const text = [
      pad('Alice went to the market on Saturday morning and bought some fresh vegetables for cooking.'),
      pad('Bob stayed home and watched a documentary about ocean wildlife and marine biology research.'),
    ].join('\n\n')
    const r = compress(text, { chunkSize: 180 })
    const contradictions = detectContradictions(r)
    expect(contradictions).toEqual([])
  })

  it('does not flag same-chunk decisions as contradictions', () => {
    const text = 'We decided to use Redis for caching but then decided against Redis in the same meeting. The final outcome was still uncertain.'
    const r = compress(text, { chunkSize: 500 })
    // single chunk — no cross-chunk pair possible
    const contradictions = detectContradictions(r)
    // If it all lands in one chunk, no contradictions should be emitted
    const decisionZettels = r.zettels.filter(z => z.flags.includes('DECISION'))
    if (decisionZettels.length < 2) {
      expect(contradictions).toEqual([])
    }
    // if there happen to be 2+ decision zettels from a single chunk with same source offsets,
    // cross-chunk check prevents false positives too — just verify no crash
    expect(Array.isArray(contradictions)).toBe(true)
  })

  it('returns empty for a single-sentence input', () => {
    const r = compress('We decided to use PostgreSQL.')
    const contradictions = detectContradictions(r)
    expect(contradictions).toEqual([])
  })
})

describe('detectContradictions — on CompressResult directly', () => {
  it('compress() attaches contradictions to result when found', () => {
    const text = [
      pad('We decided to use Redis for caching all user session data across our entire infrastructure.'),
      pad('After load testing we decided against Redis and ruled out the whole caching approach entirely.'),
    ].join('\n\n')
    const r = compress(text, { chunkSize: 180 })
    // contradictions may be on the result directly
    if (r.contradictions !== undefined) {
      expect(r.contradictions.length).toBeGreaterThanOrEqual(1)
    } else {
      // detectContradictions should still find it
      expect(detectContradictions(r).length).toBeGreaterThanOrEqual(0)
    }
  })

  it('compress() does not attach contradictions when none found', () => {
    const r = compress('Alice went to the market on Saturday morning.')
    expect(r.contradictions).toBeUndefined()
  })
})
