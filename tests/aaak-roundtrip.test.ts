import { describe, it, expect } from 'vitest'
import { encode, decode } from '../src/encoder.js'
import { buildEntityIndex } from '../src/entity-detector.js'
import { ALL_EMOTIONS, ALL_FLAGS } from '../src/types.js'
import type { CompressResult, Zettel, Tunnel, EmotionName, FlagName } from '../src/types.js'

// Deterministic PRNG (mulberry32) — property testing without a dependency.
// A failing seed reproduces exactly; print the case index from the assertion.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAME_POOL = [
  'Alice', 'Bob', 'Carol', 'MemPalace', 'JWT', 'Node.js', 'LangChain',
  'We;rd=Name', 'Back\\slash', 'Pipe|Name', 'New\nLine', 'Semi;colon',
  'Ünïcødé', '日本語', 'O\'Brien', 'Jean-Luc',
]

const TOPIC_POOL = [
  'auth', 'tokens', 'entity_index', 'snake_case_topic', 'real-time',
  'comma,topic', 'pipe|topic', 'back\\slash', 'plain', 'migration',
]

const QUOTE_PIECES = [
  'We decided to rotate the tokens.',
  'line one\nline two\r\nline three',
  'She said "quote me" twice.',
  'pipes | inside | the quote',
  'backslash \\n is not a newline',
  'emoji 🎉 and unicode é ü ñ',
  'trailing space ',
  'a'.repeat(200),
]

function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)]!
}

function sample<T>(rnd: () => number, arr: readonly T[], max: number): T[] {
  const count = Math.floor(rnd() * (max + 1))
  const out: T[] = []
  for (let i = 0; i < count; i++) {
    const v = pick(rnd, arr)
    if (!out.includes(v)) out.push(v)
  }
  return out
}

function genResult(rnd: () => number): CompressResult {
  const names = sample(rnd, NAME_POOL, 5)
  const entityIndex = buildEntityIndex(names)

  const zettelCount = 1 + Math.floor(rnd() * 7)
  const zettels: Zettel[] = Array.from({ length: zettelCount }, (_, i) => ({
    id: String(i + 1).padStart(3, '0'),
    entities: sample(rnd, names, Math.min(3, names.length)),
    topics: sample(rnd, TOPIC_POOL, 4),
    quote: pick(rnd, QUOTE_PIECES) + (rnd() > 0.5 ? ' ' + pick(rnd, QUOTE_PIECES) : ''),
    weight: Math.round(rnd() * 100) / 100,
    emotions: sample(rnd, ALL_EMOTIONS, 3) as EmotionName[],
    flags: sample(rnd, ALL_FLAGS, 2) as FlagName[],
  }))

  const tunnels: Tunnel[] = []
  if (zettelCount >= 2 && rnd() > 0.4) {
    tunnels.push({ from: zettels[0]!.id, to: zettels[1]!.id, label: 'shared_label' })
  }

  const meta: CompressResult['meta'] = {
    inputLength: 1000,
    chunkCount: zettelCount,
  }
  if (rnd() > 0.5) meta.date = '2026-06-11'
  if (rnd() > 0.5) meta.title = rnd() > 0.5 ? 'Plain Title' : 'Title|with|pipes'

  return { zettels, tunnels, entityIndex, meta }
}

describe('AAAK v2 property-based round-trip (issue #7)', () => {
  it('decode(encode(r)) is exact for 200 generated results', () => {
    const rnd = mulberry32(0xa44a /* AAAK */)
    for (let caseIdx = 0; caseIdx < 200; caseIdx++) {
      const original = genResult(rnd)
      const decoded = decode(encode(original), { strict: true })

      expect(decoded.zettels, `case ${caseIdx}: zettels`).toEqual(original.zettels)
      expect(decoded.tunnels, `case ${caseIdx}: tunnels`).toEqual(original.tunnels)
      expect(decoded.entityIndex.codeToName, `case ${caseIdx}: index`).toEqual(
        original.entityIndex.codeToName,
      )
      expect(decoded.meta?.date, `case ${caseIdx}: date`).toBe(original.meta?.date)
      expect(decoded.meta?.title, `case ${caseIdx}: title`).toBe(original.meta?.title)
      expect(decoded.meta?.warnings, `case ${caseIdx}: no warnings`).toBeUndefined()
    }
  })

  it('round-trip is stable: encode(decode(encode(r))) === encode(r)', () => {
    const rnd = mulberry32(0xbeef)
    for (let caseIdx = 0; caseIdx < 50; caseIdx++) {
      const original = genResult(rnd)
      const once = encode(original)
      const twice = encode(decode(once, { strict: true }))
      expect(twice, `case ${caseIdx}`).toBe(once)
    }
  })
})
