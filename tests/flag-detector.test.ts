import { describe, it, expect } from 'vitest'
import { detectFlags } from '../src/flag-detector.js'

describe('detectFlags', () => {
  it('detects DECISION flag', () => {
    expect(detectFlags('I decided to leave the company.')).toContain('DECISION')
  })

  it('detects ORIGIN flag', () => {
    expect(detectFlags('We founded the company in 2020.')).toContain('ORIGIN')
  })

  it('detects CORE flag', () => {
    expect(detectFlags('This is fundamental to our approach.')).toContain('CORE')
  })

  it('detects PIVOT flag', () => {
    expect(detectFlags('It was a turning point in the project.')).toContain('PIVOT')
  })

  it('detects GENESIS flag', () => {
    expect(detectFlags('This led to the founding of the new team.')).toContain('GENESIS')
  })

  it('detects TECHNICAL flag', () => {
    expect(detectFlags('We need to deploy the new architecture.')).toContain('TECHNICAL')
  })

  it('returns empty array for neutral text', () => {
    expect(detectFlags('The weather was nice today.')).toEqual([])
  })

  it('detects multiple flags', () => {
    const text = 'We decided to implement a new architecture that is fundamental to the system.'
    const flags = detectFlags(text)
    expect(flags).toContain('DECISION')
    expect(flags).toContain('CORE')
    expect(flags).toContain('TECHNICAL')
  })

  it('returns flags in deterministic order', () => {
    const text = 'We founded and decided and it was a turning point in the architecture.'
    const flags = detectFlags(text)
    const order = ['DECISION', 'ORIGIN', 'CORE', 'PIVOT', 'GENESIS', 'TECHNICAL']
    const filtered = order.filter((f) => flags.includes(f as any))
    expect(flags).toEqual(filtered)
  })

  it('is case-insensitive', () => {
    expect(detectFlags('I DECIDED to go.')).toContain('DECISION')
    expect(detectFlags('We FOUNDED this.')).toContain('ORIGIN')
  })

  it('suppresses DECISION when negated — "not decided"', () => {
    expect(detectFlags('We have not decided yet.')).not.toContain('DECISION')
  })

  it('suppresses ORIGIN when negated — "never founded"', () => {
    expect(detectFlags('They never founded a proper team.')).not.toContain('ORIGIN')
  })

  it('still detects flag when negation is far away (> 4 words before keyword)', () => {
    expect(detectFlags('Not every idea works but we finally decided to proceed with the plan.')).toContain('DECISION')
  })
})
