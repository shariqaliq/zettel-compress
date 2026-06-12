import { describe, it, expect } from 'vitest'
import { recall } from '../src/recall.js'
import { compress } from '../src/index.js'
import type { CompressResult, Zettel, Tunnel } from '../src/types.js'

interface Spec {
  quote: string
  topics?: string[]
  entities?: string[]
  weight?: number
}

function makeResult(specs: Spec[], tunnels: Tunnel[] = []): CompressResult {
  const zettels: Zettel[] = specs.map((s, i) => ({
    id: String(i + 1).padStart(3, '0'),
    entities: s.entities ?? [],
    topics: s.topics ?? [],
    quote: s.quote,
    weight: s.weight ?? 0.5,
    emotions: [],
    flags: [],
  }))
  return {
    zettels,
    tunnels,
    entityIndex: { nameToCode: {}, codeToName: {} },
    meta: { inputLength: 1000, chunkCount: zettels.length },
  }
}

const CORPUS: Spec[] = [
  {
    quote: 'We decided to rotate the authentication tokens every hour.',
    topics: ['auth', 'tokens'],
    entities: ['Alice'],
  },
  {
    quote: 'The billing pipeline batches invoices nightly for reconciliation.',
    topics: ['billing', 'invoices'],
    entities: ['Bob'],
  },
  {
    quote: 'Deployment uses blue-green switching behind the load balancer.',
    topics: ['deployment', 'infrastructure'],
  },
  {
    quote: 'The cat sat quietly on the windowsill all afternoon.',
    topics: ['cat'],
  },
]

describe('recall — BM25 retrieval (issue #10)', () => {
  it('returns the matching zettel first for a direct query', () => {
    const result = makeResult(CORPUS)
    const hits = recall(result, 'authentication tokens')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0]?.id).toBe('001')
  })

  it('finds zettels by entity name', () => {
    const result = makeResult(CORPUS)
    const hits = recall(result, 'what did Bob work on')
    expect(hits[0]?.id).toBe('002')
  })

  it('respects topK', () => {
    const result = makeResult(CORPUS)
    const hits = recall(result, 'the pipeline tokens deployment cat', { topK: 2 })
    expect(hits.length).toBeLessThanOrEqual(2)
  })

  it('returns empty for queries with no term overlap', () => {
    const result = makeResult(CORPUS)
    expect(recall(result, 'quantum chromodynamics')).toEqual([])
  })

  it('returns empty for stopword-only and empty queries', () => {
    const result = makeResult(CORPUS)
    expect(recall(result, 'what did we do')).toEqual([])
    expect(recall(result, '')).toEqual([])
    expect(recall(result, '   ')).toEqual([])
  })

  it('returns empty for empty results', () => {
    expect(recall(makeResult([]), 'anything')).toEqual([])
  })

  it('is deterministic', () => {
    const result = makeResult(CORPUS)
    const a = recall(result, 'billing invoices').map((z) => z.id)
    const b = recall(result, 'billing invoices').map((z) => z.id)
    expect(a).toEqual(b)
  })
})

describe('recall — morphological suffix folding (issue #14)', () => {
  it('matches across inflections: rotation ↔ rotate, capping ↔ cap', () => {
    const result = makeResult([
      { quote: 'We are capping the retry budget and rotating credentials.', topics: ['retries'] },
      { quote: 'The cat sat quietly on the windowsill all afternoon.', topics: ['cat'] },
    ])
    expect(recall(result, 'retry cap')[0]?.id).toBe('001')
    expect(recall(result, 'credential rotation')[0]?.id).toBe('001')
  })

  it('matches plurals and -ed forms', () => {
    const result = makeResult([
      { quote: 'The team decided on nightly invoice batches.', topics: [] },
      { quote: 'Unrelated filler text about the weather patterns.', topics: [] },
    ])
    expect(recall(result, 'what did they decide about the invoices batch')[0]?.id).toBe('001')
  })

  it('does not create false matches between unrelated stems', () => {
    const result = makeResult([
      { quote: 'The station master inspected the platform early.', topics: [] },
    ])
    expect(recall(result, 'static analysis')).toEqual([])
  })
})

describe('recall — multi-hop via tunnel graph (issue #10)', () => {
  // 001 matches the query; 002 shares a tunnel with 001 but no query terms;
  // 003 is unrelated and unlinked
  const LINKED: Spec[] = [
    {
      quote: 'We decided to rotate the authentication tokens every hour.',
      topics: ['auth', 'tokens'],
    },
    {
      quote: 'The Redis blocklist stores revoked session identifiers.',
      topics: ['redis', 'blocklist'],
    },
    {
      quote: 'The cafeteria menu changes every Wednesday without notice.',
      topics: ['cafeteria'],
    },
  ]
  const TUNNELS: Tunnel[] = [{ from: '001', to: '002', label: 'auth' }]

  it('hops surface tunnel-linked zettels that share no query terms', () => {
    const result = makeResult(LINKED, TUNNELS)
    const withHops = recall(result, 'authentication tokens', { topK: 3 })
    expect(withHops.map((z) => z.id)).toContain('002')
    expect(withHops.map((z) => z.id)).not.toContain('003')
  })

  it('hops:false restricts results to direct term matches', () => {
    const result = makeResult(LINKED, TUNNELS)
    const direct = recall(result, 'authentication tokens', { hops: false, topK: 3 })
    expect(direct.map((z) => z.id)).toEqual(['001'])
  })

  it('direct match always outranks its hop neighbor', () => {
    const result = makeResult(LINKED, TUNNELS)
    const hits = recall(result, 'authentication tokens', { topK: 3 })
    expect(hits[0]?.id).toBe('001')
  })
})

describe('recall — end to end through compress (issue #10)', () => {
  it('retrieves the decision zettel from compressed conversation text', () => {
    const text = [
      'Alice: the login service keeps timing out under load every afternoon.',
      'Bob: we decided to rotate the authentication tokens hourly and cache the session lookups.',
      'Alice: the marketing site redesign launches next Tuesday regardless.',
      'Bob: lunch options near the office are getting repetitive lately.',
    ].join('\n\n')
    const result = compress(text, { chunkSize: 90, chunkOverlap: 0 })
    const hits = recall(result, 'authentication token decision')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0]?.quote.toLowerCase()).toContain('rotate')
  })
})
