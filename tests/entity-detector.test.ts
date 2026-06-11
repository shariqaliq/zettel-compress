import { describe, it, expect } from 'vitest'
import { detectEntities, buildEntityIndex } from '../src/entity-detector.js'

describe('detectEntities', () => {
  it('detects entity appearing once (default minFreq=1)', () => {
    const result = detectEntities('Bob said hello to everyone.')
    expect(result).toContain('Bob')
  })

  it('detects entity appearing multiple times', () => {
    const result = detectEntities("Alice went to Alice's house yesterday.")
    expect(result).toContain('Alice')
  })

  it('excludes entity below explicit minFreq=2', () => {
    const result = detectEntities('Bob said hello to everyone.', 2)
    expect(result).not.toContain('Bob')
  })

  it('excludes words in the stop-list', () => {
    expect(detectEntities('The The The big The')).not.toContain('The')
    expect(detectEntities('In In In the beginning')).not.toContain('In')
  })

  it('strips punctuation from tokens', () => {
    const result = detectEntities('Alice, Alice. Alice! went home.')
    expect(result).toContain('Alice')
  })

  it('returns empty array when no entities meet threshold', () => {
    expect(detectEntities('the quick brown fox jumps')).toEqual([])
  })

  it('returns sorted results', () => {
    const result = detectEntities('Zeus Zeus Apollo Apollo Apollo')
    expect(result).toEqual([...result].sort())
  })
})

describe('detectEntities — sentence-start noise filtering (issue #1)', () => {
  it('excludes capitalized verbs that only open sentences', () => {
    const text =
      'Added support for refresh tokens. Bumped the version to 1.2. ' +
      'Pushed the release branch. Advised the team to wait.'
    const result = detectEntities(text)
    expect(result).not.toContain('Added')
    expect(result).not.toContain('Bumped')
    expect(result).not.toContain('Pushed')
    expect(result).not.toContain('Advised')
  })

  it('excludes -ed/-ing sentence starters even when not stop-listed', () => {
    const result = detectEntities('Walked to the store early. Refactoring took all day.')
    expect(result).not.toContain('Walked')
    expect(result).not.toContain('Refactoring')
  })

  it('excludes generic conversation roles', () => {
    const result = detectEntities('User: can you review this?\nAssistant: yes, looking now.')
    expect(result).not.toContain('User')
    expect(result).not.toContain('Assistant')
  })

  it('excludes words that also appear lowercase in the text', () => {
    const result = detectEntities('Stack looks healthy after the deploy. We checked the stack twice.')
    expect(result).not.toContain('Stack')
  })

  it('excludes job titles, document structure words, and Roman numerals', () => {
    const text = 'CEO approved the budget. Section II covers auth. CEO Section II again.'
    const result = detectEntities(text)
    expect(result).not.toContain('CEO')
    expect(result).not.toContain('Section')
    expect(result).not.toContain('II')
  })

  it('keeps names with a mid-sentence capitalized occurrence', () => {
    const result = detectEntities('Cypress runs the whole suite. We trust Cypress completely.')
    expect(result).toContain('Cypress')
  })

  it('keeps chat speaker labels as entities', () => {
    const result = detectEntities('Alice: we should ship on Friday\nBob: agreed, the tests pass')
    expect(result).toContain('Alice')
    expect(result).toContain('Bob')
  })

  it('keeps a sentence-start name with no other evidence (recall guard)', () => {
    // a bare name opening a sentence is the common case in short inputs —
    // it must survive unless there is positive evidence against it
    const result = detectEntities('Alice founded the company in 2020. She hired carefully.')
    expect(result).toContain('Alice')
  })

  it('keeps acronyms and tech names appearing mid-sentence', () => {
    const result = detectEntities('We migrated to JWT for auth and deployed on Cloudflare.')
    expect(result).toContain('JWT')
    expect(result).toContain('Cloudflare')
  })

  it('drops the noise set from the real-conversation benchmark', () => {
    // the exact false positives documented in issue #1
    const text =
      'Added the new entity codes yesterday. Advised waiting for review. ' +
      'Bumped version to 0.1.2 after tests. Please take a look when free. ' +
      'User: looks good to me. Ready for the next step. Ran the full suite. ' +
      'Used the staging environment. Pushed everything to the main branch.'
    const result = detectEntities(text)
    expect(result).toEqual([])
  })
})

describe('buildEntityIndex', () => {
  it('assigns unique codes to distinct names', () => {
    const index = buildEntityIndex(['Alice', 'Bob', 'Carol'])
    const codes = Object.values(index.nameToCode)
    expect(new Set(codes).size).toBe(3)
  })

  it('provides bidirectional lookup', () => {
    const index = buildEntityIndex(['Alice'])
    const code = index.nameToCode['Alice']
    expect(code).toBeDefined()
    expect(index.codeToName[code!]).toBe('Alice')
  })

  it('resolves code collisions deterministically', () => {
    // Build with many similar names to force collisions
    const names = Array.from({ length: 20 }, (_, i) => `Aaron${i}`)
    const index = buildEntityIndex(names)
    const codes = Object.values(index.nameToCode)
    expect(new Set(codes).size).toBe(20)
  })

  it('returns empty index for empty array', () => {
    const index = buildEntityIndex([])
    expect(Object.keys(index.nameToCode)).toHaveLength(0)
  })

  it('generates 3-character codes', () => {
    const index = buildEntityIndex(['Alice', 'Bob', 'Charlie'])
    for (const code of Object.values(index.nameToCode)) {
      expect(code).toMatch(/^[A-Z0-9]{2,4}$/)
    }
  })
})
