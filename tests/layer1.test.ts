import { describe, it, expect } from 'vitest'
import { wakeUp, topZettels } from '../src/layer1.js'
import type { CompressResult } from '../src/types.js'

const makeResult = (overrides: Partial<CompressResult['zettels'][number]>[] = []): CompressResult => ({
  zettels: overrides.map((o, i) => ({
    id: String(i + 1).padStart(3, '0'),
    entities: [],
    topics: [],
    quote: `Quote from zettel ${i + 1}.`,
    weight: 0.5,
    emotions: [],
    flags: [],
    ...o,
  })),
  tunnels: [],
  entityIndex: { nameToCode: {}, codeToName: {} },
})

// TypeScript helper — suppress index signature error
type ZettelOverride = {
  weight?: number
  flags?: any[]
  quote?: string
  emotions?: any[]
}

function makeR(zettels: ZettelOverride[]): CompressResult {
  return {
    zettels: zettels.map((o, i) => ({
      id: String(i + 1).padStart(3, '0'),
      entities: [],
      topics: [],
      quote: o.quote ?? `Quote ${i + 1}.`,
      weight: o.weight ?? 0.5,
      emotions: o.emotions ?? [],
      flags: o.flags ?? [],
    })),
    tunnels: [],
    entityIndex: { nameToCode: {}, codeToName: {} },
  }
}

describe('wakeUp', () => {
  it('returns empty string when no zettels meet threshold', () => {
    const result = makeR([{ weight: 0.3 }, { weight: 0.5 }, { weight: 0.7 }])
    expect(wakeUp(result)).toBe('')
  })

  it('includes zettel with weight >= 0.85', () => {
    const result = makeR([{ weight: 0.92, quote: 'We decided to move forward.' }])
    expect(wakeUp(result)).toContain('We decided to move forward.')
  })

  it('includes ORIGIN-flagged zettel even with low weight', () => {
    const result = makeR([{ weight: 0.3, flags: ['ORIGIN'], quote: 'We founded the company.' }])
    expect(wakeUp(result)).toContain('We founded the company.')
  })

  it('includes CORE-flagged zettel even with low weight', () => {
    const result = makeR([{ weight: 0.2, flags: ['CORE'], quote: 'This is essential.' }])
    expect(wakeUp(result)).toContain('This is essential.')
  })

  it('returns at most 5 sentences', () => {
    const result = makeR(Array.from({ length: 10 }, (_, i) => ({ weight: 0.9, quote: `Quote ${i}.` })))
    const output = wakeUp(result)
    const sentences = output.split('. ').filter(Boolean)
    expect(sentences.length).toBeLessThanOrEqual(5)
  })

  it('prefixes DECISION flag correctly', () => {
    const result = makeR([{ weight: 0.9, flags: ['DECISION'], quote: 'We resolved to act.' }])
    expect(wakeUp(result)).toContain('Decision:')
  })

  it('is deterministic — same input same output', () => {
    const result = makeR([{ weight: 0.9, quote: 'A key moment.' }])
    expect(wakeUp(result)).toBe(wakeUp(result))
  })
})

describe('topZettels', () => {
  it('returns top n by weight', () => {
    const result = makeR([{ weight: 0.3 }, { weight: 0.9 }, { weight: 0.6 }])
    const top = topZettels(result, 2)
    expect(top).toHaveLength(2)
    expect(top[0]?.weight).toBe(0.9)
    expect(top[1]?.weight).toBe(0.6)
  })

  it('returns all when n > zettels.length', () => {
    const result = makeR([{ weight: 0.8 }, { weight: 0.5 }])
    expect(topZettels(result, 10)).toHaveLength(2)
  })

  it('returns empty for empty result', () => {
    const result = makeR([])
    expect(topZettels(result, 5)).toHaveLength(0)
  })

  it('does not mutate original zettels order', () => {
    const result = makeR([{ weight: 0.3 }, { weight: 0.9 }, { weight: 0.6 }])
    topZettels(result, 3)
    expect(result.zettels[0]?.weight).toBe(0.3)
  })
})
