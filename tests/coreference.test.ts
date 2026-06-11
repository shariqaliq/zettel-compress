import { describe, it, expect } from 'vitest'
import { compress } from '../src/index.js'
import { resolveCoreferences } from '../src/coreference.js'
import type { TextChunk } from '../src/types.js'

function chunksOf(texts: string[]): TextChunk[] {
  let pos = 0
  return texts.map((text, index) => {
    const c = { text, index, charStart: pos, charEnd: pos + text.length }
    pos += text.length + 2
    return c
  })
}

describe('resolveCoreferences — sieve rules (issue #8)', () => {
  it('links she to the most recent female entity', () => {
    const chunks = chunksOf([
      'Alice founded the company in 2019 with outside funding.',
      'She decided to hire engineers quickly after the seed round.',
    ])
    const resolved = resolveCoreferences(chunks, [['Alice'], []])
    expect(resolved[1]).toContain('Alice')
  })

  it('links he to the most recent male entity', () => {
    const chunks = chunksOf([
      'Bob joined the platform team last spring as the lead.',
      'He committed to the migration deadline without hesitation.',
    ])
    const resolved = resolveCoreferences(chunks, [['Bob'], []])
    expect(resolved[1]).toContain('Bob')
  })

  it('resolves she and he independently in the same chunk', () => {
    const chunks = chunksOf([
      'Alice met Bob at the office to review the launch.',
      'She outlined the plan and he agreed to the timeline.',
    ])
    const resolved = resolveCoreferences(chunks, [['Alice', 'Bob'], []])
    expect(resolved[1]).toContain('Alice')
    expect(resolved[1]).toContain('Bob')
  })

  it('does not link a pronoun when the chunk already names that gender', () => {
    const chunks = chunksOf([
      'Alice presented the results to the board on Monday.',
      'Emma said she would take over the next milestone herself.',
    ])
    const resolved = resolveCoreferences(chunks, [['Alice'], ['Emma']])
    expect(resolved[1]).toContain('Emma')
    expect(resolved[1]).not.toContain('Alice')
  })

  it('links they to the two most recent entities when the chunk names none', () => {
    const chunks = chunksOf([
      'Alice and Bob debated the rollout sequencing for an hour.',
      'They decided to postpone the launch until the fix landed.',
    ])
    const resolved = resolveCoreferences(chunks, [['Alice', 'Bob'], []])
    expect(resolved[1]).toContain('Alice')
    expect(resolved[1]).toContain('Bob')
  })

  it('does not invent entities for it-pronouns or unknown names', () => {
    const chunks = chunksOf([
      'The server crashed overnight during the backup window.',
      'It restarted cleanly after the patch was applied.',
    ])
    const resolved = resolveCoreferences(chunks, [[], []])
    expect(resolved[1]).toEqual([])
  })

  it('recency wins — the later-written name is the antecedent', () => {
    const chunks = chunksOf([
      'Carol briefed the group before Alice presented the numbers.',
      'She fielded every question about the projection model.',
    ])
    const resolved = resolveCoreferences(chunks, [['Alice', 'Carol'], []])
    // Alice appears later in the text than Carol, so "she" binds to Alice
    expect(resolved[1]).toContain('Alice')
    expect(resolved[1]).not.toContain('Carol')
  })
})

describe('coreference through compress() (issue #8)', () => {
  it('pronoun-subject chunks carry the named entity into zettels', () => {
    const text = [
      'Alice founded the company in 2019 and raised the first round herself.',
      'She decided to hire the founding engineers within the first quarter.',
      'She was proud of the team culture that formed in those early months.',
    ].join('\n\n')
    const result = compress(text, { chunkSize: 80, chunkOverlap: 0 })
    expect(result.zettels.length).toBeGreaterThanOrEqual(3)
    const withAlice = result.zettels.filter((z) => z.entities.includes('Alice')).length
    // >= 80% of chunks where Alice is the (pronoun) subject must carry her
    expect(withAlice / result.zettels.length).toBeGreaterThanOrEqual(0.8)
  })

  it('builds tunnels between pronoun chunks that share the resolved entity', () => {
    const text = [
      'Alice committed to the database migration plan for the auth service.',
      'She resolved to finish the migration of the auth database this sprint.',
    ].join('\n\n')
    const result = compress(text, { chunkSize: 80, chunkOverlap: 0 })
    expect(result.zettels.length).toBe(2)
    expect(result.zettels[1]?.entities).toContain('Alice')
    expect(result.tunnels.length).toBeGreaterThanOrEqual(1)
  })
})
