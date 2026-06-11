import { describe, it, expect } from 'vitest'
import { compress, injectContext, encode, decode, wakeUp, topZettels, mergeResults } from '../src/index.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDoc(paragraphs: number): string {
  return Array.from({ length: paragraphs }, (_, i) =>
    `Paragraph ${i + 1}: Alice and Bob decided to redesign the core architecture. ` +
    `Carol committed to the migration timeline. The team resolved to deprecate the monolith. ` +
    `This is fundamental to system stability. Bob founded the platform engineering group. ` +
    `Alice determined that JWT authentication was the right approach for the API. ` +
    `The infrastructure deployment required careful planning and coordination.`,
  ).join('\n\n')
}

const DOC_SMALL  = makeDoc(5)   // ~5 chunks,  ~800 tokens
const DOC_MEDIUM = makeDoc(20)  // ~20 chunks, ~3200 tokens
const DOC_LARGE  = makeDoc(60)  // ~60 chunks, ~9600 tokens

// ── Helpers ───────────────────────────────────────────────────────────────────

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 !== 0 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2
}

function timeMs(fn: () => void, runs = 10): { median: number; max: number } {
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    fn()
    times.push(performance.now() - t)
  }
  return { median: median(times), max: Math.max(...times) }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3)
}

// Absolute time thresholds are machine-dependent. By default they are relaxed 3×
// so the suite passes on slow hardware; set ZC_PERF_STRICT=1 (e.g. on a calibrated
// CI runner) to enforce the exact targets. Relative/scaling assertions are unaffected.
const RELAX = process.env.ZC_PERF_STRICT === '1' ? 1 : 3

// ── 1. Latency benchmarks ─────────────────────────────────────────────────────

describe('latency — compress()', () => {
  it('small doc (~800 tokens) compresses in < 20ms median', () => {
    const { median: med } = timeMs(() => compress(DOC_SMALL))
    expect(med).toBeLessThan(20 * RELAX)
  })

  it('medium doc (~3200 tokens) compresses in < 50ms median', () => {
    const { median: med } = timeMs(() => compress(DOC_MEDIUM))
    expect(med).toBeLessThan(50 * RELAX)
  })

  it('large doc (~9600 tokens) compresses in < 120ms median', () => {
    const { median: med } = timeMs(() => compress(DOC_LARGE), 5)
    expect(med).toBeLessThan(120 * RELAX)
  })

  it('latency scales sub-quadratically with input size', () => {
    // 12x input should not produce 12x time — pipeline is O(n) chunks
    const { median: tSmall } = timeMs(() => compress(DOC_SMALL))
    const { median: tLarge } = timeMs(() => compress(DOC_LARGE), 5)
    const inputRatio = estimateTokens(DOC_LARGE) / estimateTokens(DOC_SMALL)
    const timeRatio = tLarge / (tSmall + 0.01)
    // Time ratio must be less than 2× the input ratio (not quadratic)
    expect(timeRatio).toBeLessThan(inputRatio * 2)
  })
})

describe('latency — encode() and decode()', () => {
  it('encode() on large result completes in < 5ms', () => {
    const result = compress(DOC_LARGE)
    const { median: med } = timeMs(() => encode(result))
    expect(med).toBeLessThan(5 * RELAX)
  })

  it('decode() on large AAAK string completes in < 5ms', () => {
    const aaak = encode(compress(DOC_LARGE))
    const { median: med } = timeMs(() => decode(aaak))
    expect(med).toBeLessThan(5 * RELAX)
  })
})

describe('latency — injectContext()', () => {
  it('injectContext() on large result completes in < 3ms', () => {
    const result = compress(DOC_LARGE)
    const { median: med } = timeMs(() => injectContext(result, { maxZettels: 10, minWeight: 0.3 }))
    expect(med).toBeLessThan(3 * RELAX)
  })

  it('injectContext() with maxTokenBudget completes in < 3ms', () => {
    const result = compress(DOC_LARGE)
    const { median: med } = timeMs(() => injectContext(result, { maxTokenBudget: 500 }))
    expect(med).toBeLessThan(3 * RELAX)
  })
})

// ── 2. Throughput ─────────────────────────────────────────────────────────────

describe('throughput', () => {
  it('processes ≥ 300 tokens/ms on medium doc', () => {
    const tokens = estimateTokens(DOC_MEDIUM)
    const { median: med } = timeMs(() => compress(DOC_MEDIUM))
    const throughput = tokens / (med + 0.01)
    expect(throughput).toBeGreaterThanOrEqual(300 / RELAX)
  })

  it('compressMany() on 10 medium docs completes in < 300ms', () => {
    const docs = Array.from({ length: 10 }, () => DOC_MEDIUM)
    const t = performance.now()
    const results = docs.map(d => compress(d))
    const elapsed = performance.now() - t
    expect(results).toHaveLength(10)
    expect(elapsed).toBeLessThan(300 * RELAX)
  })
})

// ── 3. Memory / output size ───────────────────────────────────────────────────

describe('compression ratio', () => {
  it('injectContext(10) reduces medium doc to < 15% of input tokens', () => {
    const result = compress(DOC_MEDIUM)
    const inputTok = estimateTokens(DOC_MEDIUM)
    const outputTok = estimateTokens(injectContext(result, { maxZettels: 10, minWeight: 0.3 }))
    expect(outputTok / inputTok).toBeLessThan(0.15)
  })

  it('injectContext(10) reduces large doc to < 5% of input tokens', () => {
    const result = compress(DOC_LARGE)
    const inputTok = estimateTokens(DOC_LARGE)
    const outputTok = estimateTokens(injectContext(result, { maxZettels: 10, minWeight: 0.3 }))
    expect(outputTok / inputTok).toBeLessThan(0.05)
  })

  it('wakeUp() output is always smaller than injectContext(10)', () => {
    const result = compress(DOC_MEDIUM)
    const wakeupTok = estimateTokens(wakeUp(result))
    const injectTok = estimateTokens(injectContext(result, { maxZettels: 10 }))
    // wakeUp filters to weight >= 0.85 — must be <= full inject
    expect(wakeupTok).toBeLessThanOrEqual(injectTok)
  })

  it('full AAAK encode grows linearly with zettel count, not quadratically', () => {
    const rSmall = compress(DOC_SMALL)
    const rLarge = compress(DOC_LARGE)
    const aaakSmall = encode(rSmall).length
    const aaakLarge = encode(rLarge).length
    const zettelRatio = rLarge.zettels.length / (rSmall.zettels.length + 1)
    const sizeRatio = aaakLarge / (aaakSmall + 1)
    // AAAK size should scale roughly linearly with zettel count, not faster
    expect(sizeRatio).toBeLessThan(zettelRatio * 2)
  })
})

// ── 4. Weight normalization quality ──────────────────────────────────────────

describe('weight normalization', () => {
  it('exactly one zettel scores 1.0 on multi-chunk input', () => {
    const result = compress(DOC_MEDIUM)
    const atOne = result.zettels.filter(z => z.weight === 1.0).length
    expect(atOne).toBe(1)
  })

  it('exactly one zettel scores 0.0 on multi-chunk input', () => {
    const result = compress(DOC_MEDIUM)
    const atZero = result.zettels.filter(z => z.weight === 0.0).length
    expect(atZero).toBe(1)
  })

  it('all weights are in [0, 1]', () => {
    const result = compress(DOC_LARGE)
    for (const z of result.zettels) {
      expect(z.weight).toBeGreaterThanOrEqual(0)
      expect(z.weight).toBeLessThanOrEqual(1)
    }
  })

  it('weight spread — at least 50% of zettels have unique weights on large doc', () => {
    const result = compress(DOC_LARGE)
    const unique = new Set(result.zettels.map(z => z.weight)).size
    expect(unique / result.zettels.length).toBeGreaterThanOrEqual(0.5)
  })

  it('flagged zettels have higher mean weight than unflagged (discrimination > 1.5x)', () => {
    const result = compress(DOC_MEDIUM)
    const flagged = result.zettels.filter(z => z.flags.length > 0)
    const unflagged = result.zettels.filter(z => z.flags.length === 0)
    if (flagged.length === 0 || unflagged.length === 0) return
    const meanFlagged = flagged.reduce((s, z) => s + z.weight, 0) / flagged.length
    const meanUnflagged = unflagged.reduce((s, z) => s + z.weight, 0) / unflagged.length
    if (meanUnflagged > 0) {
      expect(meanFlagged / meanUnflagged).toBeGreaterThan(1.5)
    }
  })
})

// ── 5. Tunnel count bounds ────────────────────────────────────────────────────

describe('tunnel pruning', () => {
  it('tunnel count is at most topK * zettel count', () => {
    const topK = 3
    const result = compress(DOC_LARGE, { tunnelTopK: topK })
    const maxPossible = result.zettels.length * topK
    expect(result.tunnels.length).toBeLessThanOrEqual(maxPossible)
  })

  it('tunnel count does not explode on large input (< 200 tunnels for 60-chunk doc)', () => {
    const result = compress(DOC_LARGE)
    expect(result.tunnels.length).toBeLessThan(200)
  })

  it('raising tunnelThreshold reduces tunnel count', () => {
    const rLow  = compress(DOC_MEDIUM, { tunnelThreshold: 0.1 })
    const rHigh = compress(DOC_MEDIUM, { tunnelThreshold: 0.8 })
    expect(rHigh.tunnels.length).toBeLessThanOrEqual(rLow.tunnels.length)
  })

  it('raising tunnelTopK increases or maintains tunnel count', () => {
    const rLow  = compress(DOC_MEDIUM, { tunnelTopK: 1 })
    const rHigh = compress(DOC_MEDIUM, { tunnelTopK: 5 })
    expect(rHigh.tunnels.length).toBeGreaterThanOrEqual(rLow.tunnels.length)
  })
})

// ── 6. Token budget accuracy ──────────────────────────────────────────────────

describe('token budget', () => {
  it('maxTokenBudget 500 never returns more than 550 estimated tokens', () => {
    const result = compress(DOC_LARGE)
    const out = injectContext(result, { maxTokenBudget: 500 })
    expect(estimateTokens(out)).toBeLessThanOrEqual(550)
  })

  it('maxTokenBudget 200 never returns more than 250 estimated tokens', () => {
    // Budget is approximate (~15 tokens/zettel estimate) — allow 25% overhead
    const result = compress(DOC_LARGE)
    const out = injectContext(result, { maxTokenBudget: 200 })
    expect(estimateTokens(out)).toBeLessThanOrEqual(250)
  })

  it('smaller budget always produces fewer or equal tokens than larger budget', () => {
    const result = compress(DOC_LARGE)
    const out300 = estimateTokens(injectContext(result, { maxTokenBudget: 300 }))
    const out600 = estimateTokens(injectContext(result, { maxTokenBudget: 600 }))
    expect(out300).toBeLessThanOrEqual(out600)
  })
})

// ── 7. Round-trip fidelity ────────────────────────────────────────────────────

describe('round-trip fidelity', () => {
  it('decode(encode(result)) preserves zettel count', () => {
    const original = compress(DOC_MEDIUM)
    const decoded = decode(encode(original))
    expect(decoded.zettels.length).toBe(original.zettels.length)
  })

  it('decode(encode(result)) preserves all quotes exactly', () => {
    const original = compress(DOC_SMALL)
    const decoded = decode(encode(original))
    for (let i = 0; i < original.zettels.length; i++) {
      expect(decoded.zettels[i]?.quote).toBe(original.zettels[i]?.quote)
    }
  })

  it('decode(encode(result)) preserves all weights exactly', () => {
    const original = compress(DOC_SMALL)
    const decoded = decode(encode(original))
    for (let i = 0; i < original.zettels.length; i++) {
      expect(decoded.zettels[i]?.weight).toBe(original.zettels[i]?.weight)
    }
  })

  it('decode(encode(result)) preserves all flags exactly', () => {
    const original = compress(DOC_SMALL)
    const decoded = decode(encode(original))
    for (let i = 0; i < original.zettels.length; i++) {
      expect(decoded.zettels[i]?.flags).toEqual(original.zettels[i]?.flags)
    }
  })

  it('decode(encode(result)) preserves all emotions exactly', () => {
    const original = compress(DOC_SMALL)
    const decoded = decode(encode(original))
    for (let i = 0; i < original.zettels.length; i++) {
      expect(decoded.zettels[i]?.emotions).toEqual(original.zettels[i]?.emotions)
    }
  })
})

// ── 8. Retrieval selectivity ──────────────────────────────────────────────────

describe('retrieval selectivity', () => {
  it('DECISION filter returns fewer zettels than total', () => {
    const result = compress(DOC_MEDIUM)
    const all = injectContext(result, { format: 'json' })
    const filtered = injectContext(result, { format: 'json', flags: ['DECISION'] })
    const allCount = JSON.parse(all).zettels.length
    const filteredCount = JSON.parse(filtered).zettels.length
    expect(filteredCount).toBeLessThanOrEqual(allCount)
  })

  it('topZettels(n) always returns exactly n items when n <= total', () => {
    const result = compress(DOC_MEDIUM)
    const n = Math.min(5, result.zettels.length)
    expect(topZettels(result, n)).toHaveLength(n)
  })

  it('topZettels results are sorted by weight descending', () => {
    const result = compress(DOC_LARGE)
    const top = topZettels(result, 10)
    for (let i = 0; i < top.length - 1; i++) {
      expect(top[i]!.weight).toBeGreaterThanOrEqual(top[i + 1]!.weight)
    }
  })

  it('minWeight filter never returns zettels below the threshold', () => {
    const result = compress(DOC_MEDIUM)
    const out = injectContext(result, { format: 'json', minWeight: 0.5 })
    const parsed = JSON.parse(out)
    for (const z of parsed.zettels) {
      expect(z.weight).toBeGreaterThanOrEqual(0.5)
    }
  })
})

// ── 9. mergeResults() performance ────────────────────────────────────────────

describe('mergeResults() performance', () => {
  it('merging 5 medium results completes in < 50ms', () => {
    const results = Array.from({ length: 5 }, () => compress(DOC_MEDIUM))
    const t = performance.now()
    mergeResults(results)
    expect(performance.now() - t).toBeLessThan(50 * RELAX)
  })

  it('merged result has correct total zettel count', () => {
    const r1 = compress(DOC_SMALL)
    const r2 = compress(DOC_SMALL)
    const merged = mergeResults([r1, r2])
    expect(merged.zettels.length).toBe(r1.zettels.length + r2.zettels.length)
  })

  it('merged result has globally unique zettel ids', () => {
    const results = Array.from({ length: 3 }, () => compress(DOC_SMALL))
    const merged = mergeResults(results)
    const ids = merged.zettels.map(z => z.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
