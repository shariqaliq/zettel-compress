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

describe('recall — Markov query expansion', () => {
  const text = [
    'The authentication service uses JWT tokens for session management.',
    'Redis cache stores session lookups to reduce database pressure.',
    'Token rotation policy requires hourly key refresh for security.',
    'The marketing site redesign launches next Tuesday.',
    'Lunch options near the office are getting repetitive.',
  ].join('\n\n')

  it('expandQuery returns at least as many hits as plain recall on related terms', () => {
    const result = compress(text, { chunkSize: 200, chunkOverlap: 0 })
    const plain = recall(result, 'auth', { topK: 5, hops: false, expandQuery: false })
    const expanded = recall(result, 'auth', { topK: 5, hops: false, expandQuery: true })
    // expansion must find at least as many relevant zettels
    expect(expanded.length).toBeGreaterThanOrEqual(plain.length)
  })

  it('expandQuery is deterministic across repeated calls', () => {
    const result = compress(text, { chunkSize: 200, chunkOverlap: 0 })
    const a = recall(result, 'session cache', { topK: 5, expandQuery: true })
    const b = recall(result, 'session cache', { topK: 5, expandQuery: true })
    expect(a.map((z) => z.id)).toEqual(b.map((z) => z.id))
  })

  it('expandQuery false is default — same as omitting the option', () => {
    const result = compress(text, { chunkSize: 200, chunkOverlap: 0 })
    const a = recall(result, 'token rotation', { topK: 5 })
    const b = recall(result, 'token rotation', { topK: 5, expandQuery: false })
    expect(a.map((z) => z.id)).toEqual(b.map((z) => z.id))
  })

  it('expansion does not return results for a query with no corpus overlap even after expansion', () => {
    const result = compress(text, { chunkSize: 200, chunkOverlap: 0 })
    // "xylophone" has no overlap with any topic in this corpus
    const hits = recall(result, 'xylophone', { topK: 5, expandQuery: true })
    expect(hits.length).toBe(0)
  })
})

describe('recall — #1 synonym expansion', () => {
  it('matches "relocated" when query says "moved"', () => {
    const result = makeResult([
      { quote: 'Sarah relocated to Chicago for her new position.', topics: ['chicago', 'position'] },
      { quote: 'The team deployed a hotfix to the production servers.', topics: ['deploy', 'production'] },
    ])
    const hits = recall(result, 'where did Sarah move', { hops: false })
    expect(hits[0]?.id).toBe('001')
  })

  it('matches "wedding" when query says "marry"', () => {
    const result = makeResult([
      { quote: 'Tom and Lisa had a beautiful wedding ceremony in June.', topics: ['wedding', 'june'] },
      { quote: 'The server cluster handles requests round-robin style.', topics: ['server', 'cluster'] },
    ])
    const hits = recall(result, 'when did Tom get married', { hops: false })
    expect(hits[0]?.id).toBe('001')
  })

  it('matches "quit" when query says "stopped working"', () => {
    const result = makeResult([
      { quote: 'After ten years she quit the firm and started her own consultancy.', topics: ['firm', 'consultancy'] },
      { quote: 'The CI pipeline runs unit tests on every pull request.', topics: ['ci', 'pipeline'] },
    ])
    const hits = recall(result, 'when did she stop her job', { hops: false })
    expect(hits[0]?.id).toBe('001')
  })

  it('is deterministic with synonyms active', () => {
    const result = makeResult([
      { quote: 'He transferred to the Berlin office last spring.', topics: ['berlin', 'office'] },
      { quote: 'Caching layer reduces latency for repeated lookups.', topics: ['cache', 'latency'] },
    ])
    const a = recall(result, 'who moved to Berlin', { hops: false }).map((z) => z.id)
    const b = recall(result, 'who moved to Berlin', { hops: false }).map((z) => z.id)
    expect(a).toEqual(b)
  })
})

describe('recall — #2 temporal date proximity bonus', () => {
  function makeZettelWithDate(quote: string, resolvedDate: string): Zettel {
    return {
      id: '001',
      entities: [],
      topics: [],
      quote,
      weight: 0.5,
      emotions: [],
      flags: [],
      resolvedDate,
    }
  }

  it('boosts zettel whose resolvedDate matches query year-month', () => {
    const result: CompressResult = {
      zettels: [
        { ...makeZettelWithDate('Alice visited Rome in March 2022.', '2022-03'), id: '001' },
        { ...makeZettelWithDate('Bob finished his degree in May 2020.', '2020-05'), id: '002' },
        { ...makeZettelWithDate('Carol launched her startup in June 2023.', '2023-06'), id: '003' },
      ],
      tunnels: [],
      entityIndex: { nameToCode: {}, codeToName: {} },
      meta: { inputLength: 300, chunkCount: 3 },
    }
    const hits = recall(result, 'what happened in March 2022', { hops: false, topK: 3 })
    expect(hits[0]?.id).toBe('001')
  })

  it('boosts zettel with exact year match when only year in query', () => {
    const result: CompressResult = {
      zettels: [
        { ...makeZettelWithDate('The project launched in 2021.', '2021-04'), id: '001' },
        { ...makeZettelWithDate('The team grew rapidly throughout 2019.', '2019-01'), id: '002' },
      ],
      tunnels: [],
      entityIndex: { nameToCode: {}, codeToName: {} },
      meta: { inputLength: 200, chunkCount: 2 },
    }
    const hits = recall(result, 'what was launched in 2021', { hops: false })
    expect(hits[0]?.id).toBe('001')
  })

  it('gives no bonus when no date in query', () => {
    const result: CompressResult = {
      zettels: [
        { ...makeZettelWithDate('Alice visited Rome in March 2022.', '2022-03'), id: '001' },
        { ...makeZettelWithDate('Bob visited Paris and loved the food.', '2020-05'), id: '002' },
      ],
      tunnels: [],
      entityIndex: { nameToCode: {}, codeToName: {} },
      meta: { inputLength: 200, chunkCount: 2 },
    }
    // Both mention "visited" — without date bonus BM25 is tied; order is by id
    const hits = recall(result, 'who visited a city', { hops: false, topK: 2 })
    // both should be returned; no date bonus injected
    expect(hits.length).toBe(2)
  })
})
