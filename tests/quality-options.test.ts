import { describe, it, expect } from 'vitest'
import { compress, injectContext, blendCentrality, estimateTokens } from '../src/index.js'
import type { Zettel, Tunnel } from '../src/types.js'

function makeZettels(weights: number[]): Zettel[] {
  return weights.map((w, i) => ({
    id: String(i + 1).padStart(3, '0'),
    entities: [],
    topics: [],
    quote: `Quote ${i + 1}.`,
    weight: w,
    emotions: [],
    flags: [],
  }))
}

describe('centrality-blended weights (issue #15)', () => {
  it('boosts zettels with more tunnel connections', () => {
    const zettels = makeZettels([0.5, 0.5, 0.5])
    const tunnels: Tunnel[] = [
      { from: '001', to: '002', label: 'x' },
      { from: '001', to: '003', label: 'y' },
    ]
    blendCentrality(zettels, tunnels)
    // 001 has degree 2, others degree 1
    expect(zettels[0]!.weight).toBeGreaterThan(zettels[1]!.weight)
    expect(zettels[1]!.weight).toBe(zettels[2]!.weight)
  })

  it('is a rank-preserving rescale when there are no tunnels', () => {
    const zettels = makeZettels([0.2, 0.8, 0.5])
    blendCentrality(zettels, [])
    expect(zettels[1]!.weight).toBeGreaterThan(zettels[2]!.weight)
    expect(zettels[2]!.weight).toBeGreaterThan(zettels[0]!.weight)
  })

  it('flows through compress — connected zettels outrank isolated equals', () => {
    // three near-identical decision paragraphs sharing an entity + one
    // equally-worded paragraph with a different entity and no connections
    const text = [
      'Alice decided to commit to the database migration plan this sprint.',
      'Alice resolved to commit to the migration of the database this week.',
      'Alice agreed to commit to the database migration timeline for the team.',
      'Walter decided to commit to the catering arrangement plan this spring.',
    ].join('\n\n')
    const r = compress(text, { chunkSize: 80, chunkOverlap: 0 })
    expect(r.zettels.length).toBe(4)
    const walter = r.zettels.find((z) => z.quote.includes('Walter'))!
    const connected = r.zettels.filter((z) => !z.quote.includes('Walter'))
    expect(Math.max(...connected.map((z) => z.weight))).toBeGreaterThan(walter.weight)
  })
})

describe('countTokens hook (issue #16)', () => {
  const TEXT = Array.from({ length: 12 }, (_, i) =>
    `Paragraph ${i}: Alice decided to commit to migration step number ${i} for the platform team this sprint.`,
  ).join('\n\n')

  it('budget is enforced by the injected counter', () => {
    const result = compress(TEXT, { chunkSize: 120, chunkOverlap: 0 })
    const harshCounter = (s: string) => s.length // 1 token per char — very strict
    const out = injectContext(result, { maxTokenBudget: 400, countTokens: harshCounter })
    expect(harshCounter(out)).toBeLessThanOrEqual(400)
    // the default estimate would have permitted far more content
    const defaultOut = injectContext(result, { maxTokenBudget: 400 })
    expect(estimateTokens(defaultOut)).toBeGreaterThan(harshCounter(out) / 4)
  })

  it('falls back to the built-in estimate when omitted', () => {
    const result = compress(TEXT, { chunkSize: 120, chunkOverlap: 0 })
    const out = injectContext(result, { maxTokenBudget: 300 })
    expect(estimateTokens(out)).toBeLessThanOrEqual(300)
  })
})

describe('verboseLabels (issue #17)', () => {
  const TEXT = [
    'Alice and Bob decided to commit to the database migration plan together.',
    'Alice and Bob agreed to commit to the database migration timeline jointly.',
  ].join('\n\n')

  it('uses entity names in tunnel labels when enabled', () => {
    const r = compress(TEXT, { chunkSize: 80, chunkOverlap: 0, verboseLabels: true })
    expect(r.tunnels.length).toBeGreaterThanOrEqual(1)
    expect(r.tunnels[0]?.label).toContain('Alice')
    expect(r.tunnels[0]?.label).toContain('Bob')
  })

  it('uses codes by default', () => {
    const r = compress(TEXT, { chunkSize: 80, chunkOverlap: 0 })
    expect(r.tunnels.length).toBeGreaterThanOrEqual(1)
    expect(r.tunnels[0]?.label).not.toContain('Alice')
  })
})

describe('degenerate input warning (issue #18)', () => {
  it('warns on very short input', () => {
    const r = compress('Hello world')
    expect(r.meta?.warnings?.length).toBe(1)
    expect(r.meta?.warnings?.[0]).toContain('too short')
  })

  it('does not warn on normal input', () => {
    const r = compress(
      'Alice decided to commit to the database migration plan for the team this sprint.',
    )
    expect(r.meta?.warnings).toBeUndefined()
  })
})
