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
