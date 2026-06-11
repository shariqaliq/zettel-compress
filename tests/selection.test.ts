import { describe, it, expect } from 'vitest'
import { injectContext } from '../src/index.js'
import type { CompressResult, Zettel, FlagName, EmotionName } from '../src/types.js'

interface Spec {
  weight: number
  flags?: FlagName[]
  topics?: string[]
  quote?: string
}

function makeResult(specs: Spec[]): CompressResult {
  const zettels: Zettel[] = specs.map((s, i) => ({
    id: String(i + 1).padStart(3, '0'),
    entities: [],
    topics: s.topics ?? [],
    quote: s.quote ?? `Quote number ${i + 1} content.`,
    weight: s.weight,
    emotions: [] as EmotionName[],
    flags: s.flags ?? [],
  }))
  return {
    zettels,
    tunnels: [],
    entityIndex: { nameToCode: {}, codeToName: {} },
    meta: { inputLength: 1000, chunkCount: zettels.length },
  }
}

function selectedIds(out: string): string[] {
  return (JSON.parse(out).zettels as Zettel[]).map((z) => z.id)
}

describe('injectContext selection — flag-aware ranking (issue #9)', () => {
  it('a DECISION zettel ranked 11th by weight makes the top 10', () => {
    // ten plain zettels at weights 0.80–0.89, one DECISION zettel at 0.50
    const specs: Spec[] = Array.from({ length: 10 }, (_, i) => ({ weight: 0.8 + i / 100 }))
    specs.push({ weight: 0.5, flags: ['DECISION'], quote: 'We decided to rotate tokens.' })
    const result = makeResult(specs)

    const out = injectContext(result, { maxZettels: 10, format: 'json' })
    expect(selectedIds(out)).toContain('011')
  })

  it('retains >= 70% of decision signals in a decision-sparse top-10', () => {
    // 10 decision zettels at modest weights buried under 20 louder plain ones
    const specs: Spec[] = [
      ...Array.from({ length: 20 }, (_, i) => ({ weight: 0.7 + i / 100 })),
      ...Array.from({ length: 10 }, (_, i) => ({
        weight: 0.45 + i / 100,
        flags: ['DECISION'] as FlagName[],
      })),
    ]
    const result = makeResult(specs)
    const out = injectContext(result, { maxZettels: 10, format: 'json' })
    const kept = (JSON.parse(out).zettels as Zettel[]).filter((z) =>
      z.flags.includes('DECISION'),
    ).length
    expect(kept / 10).toBeGreaterThanOrEqual(0.7)
  })

  it('is deterministic under ties', () => {
    const specs: Spec[] = Array.from({ length: 6 }, () => ({ weight: 0.5 }))
    const result = makeResult(specs)
    const a = injectContext(result, { maxZettels: 3, format: 'json' })
    const b = injectContext(result, { maxZettels: 3, format: 'json' })
    expect(a).toBe(b)
  })
})

describe('injectContext selection — guaranteeFlags (issue #9)', () => {
  it('forces a flagged zettel in even when ranking excludes it', () => {
    const specs: Spec[] = [
      ...Array.from({ length: 5 }, (_, i) => ({ weight: 0.9 - i / 100 })),
      { weight: 0.05, flags: ['DECISION'], quote: 'A buried decision.' },
    ]
    const result = makeResult(specs)
    const out = injectContext(result, {
      maxZettels: 3,
      guaranteeFlags: ['DECISION'],
      format: 'json',
    })
    expect(selectedIds(out)).toContain('006')
    expect(selectedIds(out)).toHaveLength(3)
  })

  it('pulls a guaranteed zettel past a minWeight filter', () => {
    const result = makeResult([
      { weight: 0.9 },
      { weight: 0.8 },
      { weight: 0.1, flags: ['ORIGIN'], quote: 'How it all started.' },
    ])
    const out = injectContext(result, {
      minWeight: 0.5,
      guaranteeFlags: ['ORIGIN'],
      format: 'json',
    })
    expect(selectedIds(out)).toContain('003')
  })

  it('does nothing when the flag is already represented', () => {
    const result = makeResult([
      { weight: 0.9, flags: ['DECISION'] },
      { weight: 0.8 },
      { weight: 0.2, flags: ['DECISION'] },
    ])
    const out = injectContext(result, {
      maxZettels: 2,
      guaranteeFlags: ['DECISION'],
      format: 'json',
    })
    const ids = selectedIds(out)
    expect(ids).toContain('001')
    expect(ids).not.toContain('003')
  })
})

describe('injectContext selection — MMR diversity (issue #9)', () => {
  it('mmr picks distinct topics over near-duplicates', () => {
    const specs: Spec[] = [
      { weight: 0.9, topics: ['auth', 'jwt', 'tokens'] },
      { weight: 0.89, topics: ['auth', 'jwt', 'tokens'] },
      { weight: 0.88, topics: ['auth', 'jwt', 'tokens'] },
      { weight: 0.85, topics: ['billing', 'invoices', 'payments'] },
    ]
    const result = makeResult(specs)

    const weightPick = selectedIds(injectContext(result, { maxZettels: 2, format: 'json' }))
    const mmrPick = selectedIds(
      injectContext(result, { maxZettels: 2, selection: 'mmr', format: 'json' }),
    )

    // pure ranking takes the two auth duplicates; mmr swaps one for billing
    expect(weightPick).toEqual(['001', '002'])
    expect(mmrPick).toContain('001')
    expect(mmrPick).toContain('004')
  })

  it('mmr is deterministic', () => {
    const specs: Spec[] = Array.from({ length: 8 }, (_, i) => ({
      weight: 0.5 + (i % 4) / 10,
      topics: [`topic${i % 3}`, `shared`],
    }))
    const result = makeResult(specs)
    const a = injectContext(result, { maxZettels: 4, selection: 'mmr', format: 'json' })
    const b = injectContext(result, { maxZettels: 4, selection: 'mmr', format: 'json' })
    expect(a).toBe(b)
  })
})
