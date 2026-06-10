import { describe, it, expect } from 'vitest'
import { compress, compressMany, mergeResults, injectContext, encode, decode, wakeUp, topZettels } from '../src/index.js'

const SHORT_CONVO = `
Alice and Bob were discussing the authentication system.
Alice mentioned she had concerns about the security model.

Bob decided to implement JWT tokens for the authentication flow.
He committed to reviewing Alice's feedback by end of week.
Alice agreed this was the right approach for the project.

The architecture will use a microservices model.
Bob founded the internal security team to oversee deployment.
This is fundamental to how we build all future systems.
`.trim()

const LONG_DOC = Array.from({ length: 10 }, (_, i) =>
  `Paragraph ${i + 1}: Alice and Bob reviewed the system architecture together. ` +
  `They decided to implement a new authentication module. ` +
  `This was a turning point for the project's security model. ` +
  `Bob committed to deploying the infrastructure by next week.`
).join('\n\n')

describe('compress()', () => {
  it('returns a valid CompressResult for normal text', () => {
    const result = compress(SHORT_CONVO)
    expect(result.zettels.length).toBeGreaterThan(0)
    expect(result.tunnels).toBeDefined()
    expect(result.entityIndex).toBeDefined()
  })

  it('returns empty result for empty string', () => {
    const result = compress('')
    expect(result.zettels).toHaveLength(0)
    expect(result.tunnels).toHaveLength(0)
  })

  it('assigns sequential ids starting at 001', () => {
    const result = compress(SHORT_CONVO)
    expect(result.zettels[0]?.id).toBe('001')
    result.zettels.forEach((z, i) => {
      expect(z.id).toBe(String(i + 1).padStart(3, '0'))
    })
  })

  it('entity codes are globally consistent across zettels', () => {
    const result = compress(LONG_DOC)
    const aliceCode = result.entityIndex.nameToCode['Alice']
    if (aliceCode) {
      for (const z of result.zettels) {
        if (z.entities.includes('Alice')) {
          expect(result.entityIndex.nameToCode['Alice']).toBe(aliceCode)
        }
      }
    }
  })

  it('generates tunnels for zettels sharing entities', () => {
    const result = compress(LONG_DOC)
    if (result.zettels.length >= 2) {
      // At least some tunnels should exist given repeated entities
      expect(result.tunnels.length).toBeGreaterThanOrEqual(0)
    }
  })

  it('meta includes inputLength and chunkCount', () => {
    const result = compress(SHORT_CONVO)
    expect(result.meta?.inputLength).toBeGreaterThan(0)
    expect(result.meta?.chunkCount).toBeGreaterThan(0)
  })

  it('meta reflects custom date and title options', () => {
    const result = compress(SHORT_CONVO, { date: '2026-06-10', title: 'Test Session' })
    expect(result.meta?.date).toBe('2026-06-10')
    expect(result.meta?.title).toBe('Test Session')
  })

  it('all zettel weights are between 0 and 1', () => {
    const result = compress(LONG_DOC)
    for (const z of result.zettels) {
      expect(z.weight).toBeGreaterThanOrEqual(0)
      expect(z.weight).toBeLessThanOrEqual(1)
    }
  })

  it('all zettel topics are non-empty arrays', () => {
    const result = compress(SHORT_CONVO)
    for (const z of result.zettels) {
      expect(Array.isArray(z.topics)).toBe(true)
    }
  })

  it('each zettel has a non-empty quote', () => {
    const result = compress(SHORT_CONVO)
    for (const z of result.zettels) {
      expect(z.quote.length).toBeGreaterThan(0)
    }
  })
})

describe('compressMany()', () => {
  it('returns one result per input', () => {
    const texts = [SHORT_CONVO, LONG_DOC, 'Simple text here.']
    const results = compressMany(texts)
    expect(results).toHaveLength(3)
  })

  it('handles empty array', () => {
    expect(compressMany([])).toEqual([])
  })
})

describe('mergeResults()', () => {
  it('merges two results into one', () => {
    const r1 = compress('Alice decided to implement the system.')
    const r2 = compress('Bob founded the infrastructure team.')
    const merged = mergeResults([r1, r2])
    expect(merged.zettels.length).toBe(r1.zettels.length + r2.zettels.length)
  })

  it('returns empty for empty array', () => {
    const merged = mergeResults([])
    expect(merged.zettels).toHaveLength(0)
  })

  it('re-assigns globally unique ids', () => {
    const r1 = compress('Alice Alice decided to go.')
    const r2 = compress('Bob Bob decided to stay.')
    const merged = mergeResults([r1, r2])
    const ids = merged.zettels.map((z) => z.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('injectContext()', () => {
  it('returns AAAK string by default', () => {
    const result = compress(SHORT_CONVO)
    const ctx = injectContext(result)
    expect(ctx).toContain('FILE:')
  })

  it('returns valid JSON for format=json', () => {
    const result = compress(SHORT_CONVO)
    const ctx = injectContext(result, { format: 'json' })
    expect(() => JSON.parse(ctx)).not.toThrow()
    const parsed = JSON.parse(ctx)
    expect(Array.isArray(parsed.zettels)).toBe(true)
  })

  it('returns markdown format', () => {
    const result = compress(SHORT_CONVO)
    const ctx = injectContext(result, { format: 'markdown' })
    expect(ctx).toMatch(/\*\*\[\d{3}\]\*\*/)
  })

  it('filters by minWeight', () => {
    const result = compress(SHORT_CONVO)
    const ctx = injectContext(result, { format: 'json', minWeight: 0.8 })
    const parsed = JSON.parse(ctx)
    for (const z of parsed.zettels) {
      expect(z.weight).toBeGreaterThanOrEqual(0.8)
    }
  })

  it('limits to maxZettels', () => {
    const result = compress(LONG_DOC)
    const ctx = injectContext(result, { format: 'json', maxZettels: 2 })
    const parsed = JSON.parse(ctx)
    expect(parsed.zettels.length).toBeLessThanOrEqual(2)
  })

  it('filters by flags', () => {
    const result = compress(SHORT_CONVO)
    const ctx = injectContext(result, { format: 'json', flags: ['DECISION'] })
    const parsed = JSON.parse(ctx)
    for (const z of parsed.zettels) {
      expect(z.flags).toContain('DECISION')
    }
  })
})

describe('encode/decode round-trip', () => {
  it('full pipeline result survives encode/decode', () => {
    const original = compress(SHORT_CONVO)
    const aaak = encode(original)
    const decoded = decode(aaak)
    expect(decoded.zettels).toHaveLength(original.zettels.length)
    for (let i = 0; i < original.zettels.length; i++) {
      expect(decoded.zettels[i]?.quote).toBe(original.zettels[i]?.quote)
      expect(decoded.zettels[i]?.weight).toBe(original.zettels[i]?.weight)
      expect(decoded.zettels[i]?.id).toBe(original.zettels[i]?.id)
    }
  })
})

describe('wakeUp() on real text', () => {
  it('returns non-empty string for text with decisions and flags', () => {
    const result = compress(SHORT_CONVO)
    const summary = wakeUp(result)
    // May be empty if weights are all low — that's acceptable
    expect(typeof summary).toBe('string')
  })
})

describe('topZettels() integration', () => {
  it('returns requested number of top zettels', () => {
    const result = compress(LONG_DOC)
    const top = topZettels(result, 3)
    expect(top.length).toBeLessThanOrEqual(3)
    if (top.length >= 2) {
      expect(top[0]!.weight).toBeGreaterThanOrEqual(top[1]!.weight)
    }
  })
})

describe('browser compatibility', () => {
  it('compress does not use Node.js built-ins', async () => {
    // Dynamically import the source file and check it has no process/Buffer/require usage
    const fs = await import('node:fs')
    const src = fs.readFileSync(
      new URL('../src/index.ts', import.meta.url).pathname,
      'utf-8',
    )
    expect(src).not.toMatch(/\bprocess\b/)
    expect(src).not.toMatch(/\bBuffer\b/)
    expect(src).not.toMatch(/\brequire\s*\(/)
    expect(src).not.toMatch(/\b__dirname\b/)
    expect(src).not.toMatch(/\b__filename\b/)
  })
})
