import { describe, it, expect } from 'vitest'
import {
  minhashSignature,
  estimateJaccard,
  exactJaccard,
  lshCandidatePairs,
} from '../src/minhash.js'
import { buildTunnels } from '../src/tunnel-builder.js'
import { compress, CompressStream } from '../src/index.js'
import type { Zettel } from '../src/types.js'

const set = (...xs: string[]) => new Set(xs)

describe('minhash signatures (issue #13)', () => {
  it('is deterministic — same tokens, same signature', () => {
    const a = minhashSignature(['auth', 'tokens', 'redis'])
    const b = minhashSignature(['auth', 'tokens', 'redis'])
    expect([...a]).toEqual([...b])
  })

  it('is order-insensitive', () => {
    const a = minhashSignature(['auth', 'tokens', 'redis'])
    const b = minhashSignature(['redis', 'auth', 'tokens'])
    expect([...a]).toEqual([...b])
  })

  it('identical sets estimate Jaccard 1, disjoint sets near 0', () => {
    const a = minhashSignature(['alpha', 'beta', 'gamma'])
    const b = minhashSignature(['alpha', 'beta', 'gamma'])
    const c = minhashSignature(['delta', 'epsilon', 'zeta'])
    expect(estimateJaccard(a, b)).toBe(1)
    expect(estimateJaccard(a, c)).toBeLessThan(0.2)
  })

  it('estimate tracks exact Jaccard within tolerance', () => {
    // J = 5/15 ≈ 0.33
    const xs = Array.from({ length: 10 }, (_, i) => `x${i}`)
    const shared = xs.slice(0, 5)
    const ys = [...shared, ...Array.from({ length: 5 }, (_, i) => `y${i}`)]
    const est = estimateJaccard(minhashSignature(xs), minhashSignature(ys))
    const exact = exactJaccard(new Set(xs), new Set(ys))
    expect(Math.abs(est - exact)).toBeLessThan(0.25)
  })
})

describe('exactJaccard', () => {
  it('computes standard values', () => {
    expect(exactJaccard(set('a', 'b'), set('a', 'b'))).toBe(1)
    expect(exactJaccard(set('a', 'b'), set('c', 'd'))).toBe(0)
    expect(exactJaccard(set('a', 'b', 'c'), set('b', 'c', 'd'))).toBe(0.5)
    expect(exactJaccard(set(), set('a'))).toBe(0)
  })
})

describe('lshCandidatePairs', () => {
  it('finds high-similarity pairs and is deterministic', () => {
    const sigs = [
      minhashSignature(['auth', 'tokens', 'rotation', 'redis']),
      minhashSignature(['auth', 'tokens', 'rotation', 'cache']), // J=0.6 with [0]
      minhashSignature(['billing', 'invoices', 'nightly', 'batch']),
    ]
    const pairs = lshCandidatePairs(sigs)
    expect(pairs).toContainEqual([0, 1])
    expect(lshCandidatePairs(sigs)).toEqual(pairs)
  })
})

describe('buildTunnels — LSH path above 500 zettels (issue #13)', () => {
  function makeZettel(id: number, topics: string[], entities: string[] = []): Zettel {
    return {
      id: String(id).padStart(4, '0'),
      entities,
      topics,
      quote: `Quote ${id}.`,
      weight: 0.5,
      emotions: [],
      flags: [],
    }
  }

  it('still tunnels planted similar pairs in a 600-zettel set, fast', () => {
    // 600 zettels with unique topics + 5 planted pairs sharing all topics
    const zettels: Zettel[] = []
    for (let i = 0; i < 590; i++) {
      zettels.push(makeZettel(i, [`solo${i}a`, `solo${i}b`, `solo${i}c`]))
    }
    for (let p = 0; p < 5; p++) {
      const topics = [`pair${p}x`, `pair${p}y`, `pair${p}z`]
      zettels.push(makeZettel(600 + p * 2, topics, ['Alice']))
      zettels.push(makeZettel(601 + p * 2, topics, ['Alice']))
    }
    const index = { nameToCode: { Alice: 'ALC' }, codeToName: { ALC: 'Alice' } }

    const t0 = performance.now()
    const tunnels = buildTunnels(zettels, index)
    const elapsed = performance.now() - t0

    for (let p = 0; p < 5; p++) {
      const from = String(600 + p * 2).padStart(4, '0')
      const to = String(601 + p * 2).padStart(4, '0')
      expect(tunnels.some((t) => t.from === from && t.to === to)).toBe(true)
    }
    // 600 zettels all-pairs would be ~180k comparisons; LSH should be quick
    expect(elapsed).toBeLessThan(500)
  })

  it('LSH path is deterministic', () => {
    const zettels = Array.from({ length: 550 }, (_, i) =>
      makeZettel(i, [`t${i % 50}a`, `t${i % 50}b`, `extra${i}`]),
    )
    const index = { nameToCode: {}, codeToName: {} }
    const a = buildTunnels(zettels, index)
    const b = buildTunnels(zettels, index)
    expect(a).toEqual(b)
  })
})

describe('dedupe through compress (issue #13)', () => {
  const REPEATED =
    'Alice committed to the database migration plan for the auth service this sprint.'
  const TEXT = [
    REPEATED,
    'The billing pipeline batches invoices nightly for reconciliation and review.',
    REPEATED,
    'Deployment uses blue-green switching behind the load balancer for safety.',
    REPEATED,
  ].join('\n\n')

  it('merges repeated paragraphs when dedupe is on', () => {
    const plain = compress(TEXT, { chunkSize: 90, chunkOverlap: 0 })
    const deduped = compress(TEXT, { chunkSize: 90, chunkOverlap: 0, dedupe: true })
    expect(plain.zettels.length).toBe(5)
    expect(deduped.zettels.length).toBe(3)
    const repeats = deduped.zettels.filter((z) => z.quote.includes('migration plan'))
    expect(repeats).toHaveLength(1)
  })

  it('keeps distinct paragraphs apart', () => {
    const deduped = compress(TEXT, { chunkSize: 90, chunkOverlap: 0, dedupe: true })
    expect(deduped.zettels.some((z) => z.quote.includes('billing'))).toBe(true)
    expect(deduped.zettels.some((z) => z.quote.includes('blue-green'))).toBe(true)
  })

  it('is off by default and deterministic when on', () => {
    const plain = compress(TEXT, { chunkSize: 90, chunkOverlap: 0 })
    expect(plain.zettels.length).toBe(5)
    const a = compress(TEXT, { chunkSize: 90, chunkOverlap: 0, dedupe: true })
    const b = compress(TEXT, { chunkSize: 90, chunkOverlap: 0, dedupe: true })
    expect(a).toEqual(b)
  })
})

describe('dedupe through CompressStream (issue #13)', () => {
  const MSG = 'We decided to rotate the authentication tokens hourly from now on.'

  it('absorbs repeated messages instead of growing', () => {
    const stream = new CompressStream({ dedupe: true })
    stream.push(MSG)
    stream.push('The cafeteria menu changes every Wednesday without notice.')
    stream.push(MSG)
    stream.push(MSG)
    expect(stream.size).toBe(2)
  })

  it('repetition refreshes recency — duplicate outlives decay', () => {
    const stream = new CompressStream({ dedupe: true, halfLifeTurns: 1, maxZettels: 2 })
    stream.push(MSG) // turn 1
    stream.push('Filler one with nothing notable inside it at all today.') // turn 2
    stream.push('Filler two with nothing notable inside it at all again.') // turn 3 — evicts something
    stream.push(MSG) // turn 4 — re-pushed: must survive as refreshed or new
    const snap = stream.snapshot()
    expect(snap.zettels.some((z) => z.quote.includes('rotate'))).toBe(true)
    const top = [...snap.zettels].sort((a, b) => b.weight - a.weight)[0]
    expect(top?.quote).toContain('rotate')
  })

  it('stays deterministic with dedupe on', () => {
    const a = new CompressStream({ dedupe: true })
    const b = new CompressStream({ dedupe: true })
    for (const m of [MSG, 'Other message about deployment pipelines.', MSG]) {
      a.push(m)
      b.push(m)
    }
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()))
  })
})
