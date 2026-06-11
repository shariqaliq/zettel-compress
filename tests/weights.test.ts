import { describe, it, expect } from 'vitest'
import { normalizeWeights, mergeResults, compress } from '../src/index.js'
import type { Zettel, CompressResult } from '../src/types.js'

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

function makeResult(weights: number[]): CompressResult {
  return {
    zettels: makeZettels(weights),
    tunnels: [],
    entityIndex: { nameToCode: {}, codeToName: {} },
    meta: { inputLength: 100, chunkCount: weights.length },
  }
}

describe('normalizeWeights — tie handling (issue #6)', () => {
  it('equal raw weights produce equal normalized weights', () => {
    const zettels = makeZettels([0.5, 0.5, 0.9])
    normalizeWeights(zettels)
    expect(zettels[0]!.weight).toBe(zettels[1]!.weight)
    expect(zettels[2]!.weight).toBe(1.0)
  })

  it('input order does not influence tied weights', () => {
    const a = makeZettels([0.5, 0.5, 0.5, 0.9, 0.1])
    const b = makeZettels([0.9, 0.5, 0.1, 0.5, 0.5])
    normalizeWeights(a)
    normalizeWeights(b)
    // the three tied 0.5 zettels must all land on the same value in both runs
    const tiedA = [a[0]!.weight, a[1]!.weight, a[2]!.weight]
    const tiedB = [b[1]!.weight, b[3]!.weight, b[4]!.weight]
    expect(new Set(tiedA).size).toBe(1)
    expect(new Set(tiedB).size).toBe(1)
    expect(tiedA[0]).toBe(tiedB[0])
  })

  it('all-tied input maps every zettel to 1.0 (equally important)', () => {
    const zettels = makeZettels([0.65, 0.65, 0.65, 0.65])
    normalizeWeights(zettels)
    for (const z of zettels) expect(z.weight).toBe(1.0)
  })

  it('distinct raw weights span the full [0, 1] range', () => {
    const zettels = makeZettels([0.1, 0.3, 0.5, 0.7, 0.9])
    normalizeWeights(zettels)
    expect(Math.max(...zettels.map((z) => z.weight))).toBe(1.0)
    expect(Math.min(...zettels.map((z) => z.weight))).toBe(0.0)
  })

  it('preserves rank order of distinct raw weights', () => {
    const zettels = makeZettels([0.2, 0.8, 0.5])
    normalizeWeights(zettels)
    expect(zettels[1]!.weight).toBeGreaterThan(zettels[2]!.weight)
    expect(zettels[2]!.weight).toBeGreaterThan(zettels[0]!.weight)
  })

  it('leaves single-zettel results untouched', () => {
    const zettels = makeZettels([0.65])
    normalizeWeights(zettels)
    expect(zettels[0]!.weight).toBe(0.65)
  })
})

describe('mergeResults — weight re-normalization (issue #6)', () => {
  it('re-normalizes weights over the merged set', () => {
    const r1 = makeResult([1.0, 0.5, 0.0])
    const r2 = makeResult([1.0, 0.5, 0.0])
    const merged = mergeResults([r1, r2])
    // pre-merge ties must remain ties after global re-normalization
    const weights = merged.zettels.map((z) => z.weight)
    expect(weights[0]).toBe(weights[3])
    expect(weights[1]).toBe(weights[4])
    expect(weights[2]).toBe(weights[5])
    expect(Math.max(...weights)).toBe(1.0)
    expect(Math.min(...weights)).toBe(0.0)
  })

  it('puts a single-chunk result on the same scale as a multi-chunk result', () => {
    // single-chunk results skip normalization and carry raw scores —
    // after merging, everything must be on one comparable scale
    const single = compress('We decided to commit to the new architecture and deploy it.')
    const multi = compress(
      ['The weather report was uneventful and routine for the season.',
       'Another plain paragraph with nothing notable inside it at all.',
       'We resolved to migrate the database and committed to the plan.'].join('\n\n'),
      { chunkSize: 80 },
    )
    const merged = mergeResults([single, multi])
    for (const z of merged.zettels) {
      expect(z.weight).toBeGreaterThanOrEqual(0)
      expect(z.weight).toBeLessThanOrEqual(1)
    }
    expect(Math.max(...merged.zettels.map((z) => z.weight))).toBe(1.0)
  })
})
