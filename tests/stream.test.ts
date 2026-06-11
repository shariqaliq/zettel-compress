import { describe, it, expect } from 'vitest'
import { CompressStream } from '../src/stream.js'
import { encode } from '../src/encoder.js'

const MESSAGES = [
  'Alice: the login service keeps timing out under load every single afternoon now.',
  'Bob: we decided to rotate the authentication tokens hourly and cache the session lookups.',
  'Alice: she also wants the deploy pipeline to gate on the new integration suite.',
  'Bob: the cafeteria menu rotation is honestly the least of our problems this week.',
  'Alice: we committed to shipping the token rotation behind a feature flag on Friday.',
]

describe('CompressStream — incremental compression (issue #11)', () => {
  it('builds zettels incrementally with unique sequential ids', () => {
    const stream = new CompressStream()
    for (const m of MESSAGES) stream.push(m)
    const snap = stream.snapshot()
    expect(snap.zettels.length).toBe(MESSAGES.length)
    const ids = snap.zettels.map((z) => z.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('entity codes never change once assigned', () => {
    const stream = new CompressStream()
    stream.push('Alice: the login service keeps timing out under heavy load today.')
    const codeBefore = stream.snapshot().entityIndex.nameToCode['Alice']
    expect(codeBefore).toBeDefined()
    // push many new entities that could collide
    stream.push('Alfred met Alonzo and Alvaro near the Albuquerque office yesterday.')
    const after = stream.snapshot().entityIndex.nameToCode
    expect(after['Alice']).toBe(codeBefore)
  })

  it('resolves pronouns across pushes', () => {
    const stream = new CompressStream()
    stream.push('Alice: the login service keeps timing out under heavy load today.')
    stream.push('She decided to rotate the credentials and restart the workers.')
    const snap = stream.snapshot()
    expect(snap.zettels[1]?.entities).toContain('Alice')
  })

  it('applies recency decay — older equal-raw zettels rank lower', () => {
    const text = 'We decided to commit to the migration plan for the platform.'
    const stream = new CompressStream({ halfLifeTurns: 2 })
    stream.push(text)
    stream.push('Filler message with nothing notable inside it at all today.')
    stream.push('Filler message with nothing notable inside it at all again.')
    stream.push(text) // identical raw weight, much newer
    const snap = stream.snapshot()
    const first = snap.zettels[0]!
    const last = snap.zettels[snap.zettels.length - 1]!
    expect(last.weight).toBeGreaterThan(first.weight)
  })

  it('no decay without halfLifeTurns — identical messages tie exactly', () => {
    const text = 'We decided to commit to the migration plan for the platform.'
    const stream = new CompressStream()
    stream.push(text)
    stream.push(text)
    const snap = stream.snapshot()
    expect(snap.zettels[0]?.weight).toBe(snap.zettels[1]?.weight)
  })

  it('maxZettels keeps memory bounded by evicting lowest decayed weight', () => {
    const stream = new CompressStream({ maxZettels: 3, halfLifeTurns: 2 })
    for (const m of MESSAGES) stream.push(m)
    expect(stream.size).toBe(3)
    const snap = stream.snapshot()
    expect(snap.zettels.length).toBe(3)
    // the strongest recent decision zettel must survive
    expect(snap.zettels.some((z) => z.quote.includes('feature flag'))).toBe(true)
  })

  it('replay is deterministic — same pushes, byte-identical snapshot', () => {
    const a = new CompressStream({ halfLifeTurns: 3, maxZettels: 4 })
    const b = new CompressStream({ halfLifeTurns: 3, maxZettels: 4 })
    for (const m of MESSAGES) {
      a.push(m)
      b.push(m)
    }
    expect(encode(a.snapshot())).toBe(encode(b.snapshot()))
  })

  it('recall works over the live stream', () => {
    const stream = new CompressStream()
    for (const m of MESSAGES) stream.push(m)
    const hits = stream.recall('authentication token rotation')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0]?.quote.toLowerCase()).toContain('rotat')
  })

  it('empty and whitespace pushes are no-ops', () => {
    const stream = new CompressStream()
    stream.push('')
    stream.push('   \n\n  ')
    expect(stream.size).toBe(0)
    expect(stream.snapshot().zettels).toEqual([])
  })

  it('builds tunnels across messages that share entities', () => {
    const stream = new CompressStream()
    stream.push('Alice committed to the database migration plan for the auth service.')
    stream.push('Alice resolved to finish the auth database migration this sprint.')
    const snap = stream.snapshot()
    expect(snap.tunnels.length).toBeGreaterThanOrEqual(1)
  })
})
