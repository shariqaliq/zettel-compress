import { describe, it, expect } from 'vitest'
import { encode, decode } from '../src/encoder.js'
import type { CompressResult } from '../src/types.js'

const sampleResult: CompressResult = {
  zettels: [
    {
      id: '001',
      entities: ['Alice', 'Bob'],
      topics: ['authentication', 'security'],
      quote: 'We decided to use JWT tokens for authentication.',
      weight: 0.91,
      emotions: ['conviction'],
      flags: ['DECISION', 'TECHNICAL'],
    },
    {
      id: '002',
      entities: ['Alice'],
      topics: ['security', 'deployment'],
      quote: 'Alice was afraid the system would fail.',
      weight: 0.55,
      emotions: ['fear'],
      flags: ['TECHNICAL'],
    },
  ],
  tunnels: [{ from: '001', to: '002', label: 'ALC' }],
  entityIndex: {
    nameToCode: { Alice: 'ALC', Bob: 'BOB' },
    codeToName: { ALC: 'Alice', BOB: 'Bob' },
  },
  meta: { inputLength: 200, chunkCount: 2, date: '2026-06-10', title: 'Auth Design' },
}

describe('encode', () => {
  it('produces a FILE: header line', () => {
    const result = encode(sampleResult)
    expect(result.startsWith('FILE:')).toBe(true)
  })

  it('contains zettel lines for each zettel', () => {
    const result = encode(sampleResult)
    expect(result).toContain('001:')
    expect(result).toContain('002:')
  })

  it('contains tunnel line', () => {
    const result = encode(sampleResult)
    expect(result).toContain('T:001<->002')
  })

  it('encodes weight with 2 decimal places', () => {
    const result = encode(sampleResult)
    expect(result).toContain('0.91')
    expect(result).toContain('0.55')
  })

  it('handles empty zettels array', () => {
    const empty: CompressResult = {
      zettels: [],
      tunnels: [],
      entityIndex: { nameToCode: {}, codeToName: {} },
    }
    const result = encode(empty)
    expect(result).toContain('FILE:000')
  })
})

describe('decode', () => {
  it('round-trips a full result', () => {
    const aaak = encode(sampleResult)
    const decoded = decode(aaak)
    expect(decoded.zettels).toHaveLength(2)
    expect(decoded.zettels[0]?.id).toBe('001')
    expect(decoded.zettels[0]?.quote).toBe('We decided to use JWT tokens for authentication.')
    expect(decoded.zettels[0]?.weight).toBe(0.91)
    expect(decoded.zettels[0]?.emotions).toContain('conviction')
    expect(decoded.zettels[0]?.flags).toContain('DECISION')
    expect(decoded.tunnels).toHaveLength(1)
    expect(decoded.tunnels[0]?.from).toBe('001')
    expect(decoded.tunnels[0]?.to).toBe('002')
  })

  it('handles quotes containing pipe characters', () => {
    const tricky: CompressResult = {
      ...sampleResult,
      zettels: [
        {
          ...sampleResult.zettels[0]!,
          quote: 'I said: hello | goodbye to the team.',
        },
      ],
      tunnels: [],
    }
    const aaak = encode(tricky)
    const decoded = decode(aaak)
    expect(decoded.zettels[0]?.quote).toBe('I said: hello | goodbye to the team.')
  })

  it('parses meta date and title', () => {
    const aaak = encode(sampleResult)
    const decoded = decode(aaak)
    expect(decoded.meta?.date).toBe('2026-06-10')
    expect(decoded.meta?.title).toBe('Auth Design')
  })

  it('returns empty result for empty string', () => {
    const result = decode('')
    expect(result.zettels).toHaveLength(0)
    expect(result.tunnels).toHaveLength(0)
  })

  it('handles result with no tunnels', () => {
    const noTunnels: CompressResult = { ...sampleResult, tunnels: [] }
    const decoded = decode(encode(noTunnels))
    expect(decoded.tunnels).toHaveLength(0)
  })

  it('preserves multi-line quotes exactly (v2 escaping)', () => {
    const multiline: CompressResult = {
      ...sampleResult,
      zettels: sampleResult.zettels.map((z) => ({
        ...z,
        quote: 'User: can we fix auth?\nAssistant: yes,\r\nwe decided to rotate tokens.',
      })),
      tunnels: [],
    }
    const decoded = decode(encode(multiline))
    expect(decoded.zettels).toHaveLength(multiline.zettels.length)
    expect(decoded.zettels[0]?.quote).toBe(
      'User: can we fix auth?\nAssistant: yes,\r\nwe decided to rotate tokens.',
    )
  })

  it('recovers entity names through the E: index line (issue #7)', () => {
    const decoded = decode(encode(sampleResult))
    expect(decoded.zettels[0]?.entities).toEqual(['Alice', 'Bob'])
    expect(decoded.entityIndex.codeToName['ALC']).toBe('Alice')
    expect(decoded.entityIndex.nameToCode['Bob']).toBe('BOB')
  })

  it('preserves quotes containing double quotes and backslashes', () => {
    const tricky: CompressResult = {
      ...sampleResult,
      zettels: [
        {
          ...sampleResult.zettels[0]!,
          quote: 'She said "ship it\\now" and | meant it.',
        },
      ],
      tunnels: [],
    }
    const decoded = decode(encode(tricky))
    expect(decoded.zettels[0]?.quote).toBe('She said "ship it\\now" and | meant it.')
  })

  it('preserves snake_case topics (issue #7)', () => {
    const tricky: CompressResult = {
      ...sampleResult,
      zettels: [
        {
          ...sampleResult.zettels[0]!,
          topics: ['entity_index', 'snake_case', 'plain'],
        },
      ],
      tunnels: [],
    }
    const decoded = decode(encode(tricky))
    expect(decoded.zettels[0]?.topics).toEqual(['entity_index', 'snake_case', 'plain'])
  })

  it('still decodes legacy v1 output (no E: line, _ topics)', () => {
    const v1 =
      'FILE:001|ALC|2026-06-10|Legacy\n' +
      '001:ALC|authentication_security|"We decided to use JWT tokens."|0.91|conviction|DECISION'
    const decoded = decode(v1)
    expect(decoded.zettels).toHaveLength(1)
    expect(decoded.zettels[0]?.topics).toEqual(['authentication', 'security'])
    expect(decoded.zettels[0]?.flags).toEqual(['DECISION'])
  })

  it('collects warnings for malformed lines instead of silently dropping', () => {
    const aaak = encode(sampleResult) + '\nthis is not a valid line at all'
    const decoded = decode(aaak)
    expect(decoded.zettels).toHaveLength(2)
    expect(decoded.meta?.warnings?.length).toBeGreaterThanOrEqual(1)
  })

  it('strict mode throws on malformed lines', () => {
    const aaak = encode(sampleResult) + '\nthis is not a valid line at all'
    expect(() => decode(aaak, { strict: true })).toThrow(/malformed/)
  })

  it('warns when header count disagrees with parsed zettels', () => {
    const lines = encode(sampleResult).split('\n')
    lines[0] = lines[0]!.replace('FILE:002', 'FILE:009')
    const decoded = decode(lines.join('\n'))
    expect(decoded.meta?.warnings?.some((w) => w.includes('declares'))).toBe(true)
  })

  it('drops unknown emotions and flags with a warning', () => {
    const aaak =
      'FILE:001|||x|v2\n' +
      '001:||"A quote about the plan."|0.50|conviction+notanemotion|DECISION+NOTAFLAG'
    const decoded = decode(aaak)
    expect(decoded.zettels[0]?.emotions).toEqual(['conviction'])
    expect(decoded.zettels[0]?.flags).toEqual(['DECISION'])
    expect(decoded.meta?.warnings?.length).toBe(2)
  })
})
