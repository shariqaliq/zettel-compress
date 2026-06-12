import { describe, it, expect } from 'vitest'
import { compress, recallContext, mergeResults, estimateTokens } from '../src/index.js'
import { CompressStream } from '../src/stream.js'
import { encode, decode } from '../src/encoder.js'

// the answer ("seventeen rotations per hour") lives in a sentence that is NOT
// the chunk's key quote — only provenance expansion can surface it
const DOC = [
  'Alice opened the meeting with a long recap of the previous sprint and thanked everyone for attending despite the rain.',
  'Bob mentioned in passing that the token refresher performs seventeen rotations per hour under load. ' +
    'We decided to commit to the new deployment cadence for the platform going forward.',
  'Carol presented the billing reconciliation numbers and the invoices matched for the third week running.',
  'The group wrapped up with a discussion of the upcoming offsite and the catering arrangements for it.',
].join('\n\n')

describe('provenance on compress (issue: provenance-expanded recall)', () => {
  it('zettels carry exact source offsets into meta.source', () => {
    const r = compress(DOC, { chunkSize: 150, chunkOverlap: 0 })
    expect(r.meta?.source).toBeDefined()
    for (const z of r.zettels) {
      expect(z.sourceStart).toBeTypeOf('number')
      const slice = r.meta!.source!.slice(z.sourceStart!, z.sourceEnd!)
      expect(slice).toContain(z.quote.slice(0, 30))
    }
  })

  it('keepSource: false omits the source text', () => {
    const r = compress(DOC, { keepSource: false })
    expect(r.meta?.source).toBeUndefined()
  })

  it('offsets survive the AAAK round-trip', () => {
    const r = compress(DOC, { chunkSize: 150, chunkOverlap: 0 })
    const back = decode(encode(r), { strict: true })
    expect(back.zettels.map((z) => [z.sourceStart, z.sourceEnd])).toEqual(
      r.zettels.map((z) => [z.sourceStart, z.sourceEnd]),
    )
  })

  it('mergeResults drops offsets that would point into the wrong document', () => {
    const r1 = compress(DOC, { chunkSize: 150, chunkOverlap: 0 })
    const merged = mergeResults([r1, r1])
    for (const z of merged.zettels) {
      expect(z.sourceStart).toBeUndefined()
    }
  })
})

describe('recallContext — small-to-big retrieval', () => {
  it('returns the full passage containing a detail the quote dropped', () => {
    const r = compress(DOC, { chunkSize: 150, chunkOverlap: 0 })
    const ctx = recallContext(r, 'how many rotations per hour does the token refresher do?')
    expect(ctx).toContain('seventeen rotations per hour')
  })

  it('ranking also matches details outside the quote (source-aware BM25)', () => {
    const r = compress(DOC, { chunkSize: 150, chunkOverlap: 0 })
    // "reconciliation" appears only in Carol's chunk body
    const ctx = recallContext(r, 'billing reconciliation invoices')
    expect(ctx).toContain('reconciliation')
  })

  it('merges overlapping spans and emits document order', () => {
    const r = compress(DOC, { chunkSize: 150, chunkOverlap: 60 })
    const ctx = recallContext(r, 'token rotations deployment cadence billing invoices', { topK: 6 })
    // document order: Bob's chunk content precedes Carol's
    const bobIdx = ctx.indexOf('seventeen rotations')
    const carolIdx = ctx.indexOf('reconciliation')
    expect(bobIdx).toBeGreaterThanOrEqual(0)
    expect(carolIdx).toBeGreaterThan(bobIdx)
    // overlapping spans must not duplicate text
    const first = ctx.indexOf('seventeen rotations per hour')
    expect(ctx.indexOf('seventeen rotations per hour', first + 1)).toBe(-1)
  })

  it('respects maxTokens while always returning at least one passage', () => {
    const r = compress(DOC, { chunkSize: 150, chunkOverlap: 0 })
    const ctx = recallContext(r, 'rotations deployment billing offsite', {
      topK: 6,
      maxTokens: 60,
    })
    expect(ctx.length).toBeGreaterThan(0)
    // either within budget, or a single passage that alone exceeds it
    const spans = ctx.split('\n\n')
    if (estimateTokens(ctx) > 60) expect(spans.length).toBe(1)
  })

  it('falls back to quotes when source is absent (decoded results)', () => {
    const r = compress(DOC, { chunkSize: 150, chunkOverlap: 0 })
    const decoded = decode(encode(r)) // AAAK never carries source
    const ctx = recallContext(decoded, 'deployment cadence')
    expect(ctx.length).toBeGreaterThan(0)
    expect(ctx).toContain('decided')
  })

  it('source option supplies text for decoded results', () => {
    const r = compress(DOC, { chunkSize: 150, chunkOverlap: 0 })
    const decoded = decode(encode(r))
    const ctx = recallContext(decoded, 'token refresher rotations', {
      source: r.meta!.source!,
    })
    expect(ctx).toContain('seventeen rotations per hour')
  })

  it('returns empty for no-match queries', () => {
    const r = compress(DOC, { chunkSize: 150, chunkOverlap: 0 })
    expect(recallContext(r, 'quantum chromodynamics')).toBe('')
  })
})

describe('recallContext through CompressStream', () => {
  it('expands across pushed messages with correct offsets', () => {
    const stream = new CompressStream()
    stream.push('Alice: the deploy pipeline gates on the integration suite now, took all morning to wire up.')
    stream.push('Bob: noted that the cache layer evicts after ninety seconds under memory pressure.')
    stream.push('Alice: lunch options were disappointing again today.')
    const ctx = stream.recallContext('when does the cache evict?')
    expect(ctx).toContain('ninety seconds')
  })

  it('replay determinism holds with source logs', () => {
    const a = new CompressStream()
    const b = new CompressStream()
    for (const m of ['First message about deployment.', 'Second message about billing.']) {
      a.push(m)
      b.push(m)
    }
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()))
  })
})
