import type { CompressResult, Zettel } from './types.js'

const WAKE_UP_FLAGS = new Set(['ORIGIN', 'CORE', 'GENESIS'])
const WAKE_UP_MAX = 5
const FLAG_PREFIXES: Record<string, string> = {
  ORIGIN:    'Origin: ',
  CORE:      'Core: ',
  GENESIS:   'Genesis: ',
  DECISION:  'Decision: ',
  PIVOT:     'Pivot: ',
  TECHNICAL: 'Technical: ',
}

export function wakeUp(result: CompressResult, topPct = 0.15): string {
  const zettels = result.zettels
  if (zettels.length === 0) return ''

  // Percentile threshold: weights are rank-normalized, so a fixed cutoff like
  // 0.85 admits a shrinking share of zettels as documents grow. The cutoff is
  // the weight of the ceil(n * topPct)-th ranked zettel, so output scales with
  // the document and is never empty on non-empty input.
  const limit = Math.min(WAKE_UP_MAX, Math.max(1, Math.ceil(zettels.length * topPct)))
  const byWeight = [...zettels].sort((a, b) => b.weight - a.weight)
  const threshold = byWeight[limit - 1]?.weight ?? 0

  const candidates = zettels
    .filter((z) => z.weight >= threshold || z.flags.some((f) => WAKE_UP_FLAGS.has(f)))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, WAKE_UP_MAX)

  if (candidates.length === 0) return ''

  const sentences = candidates.map((z) => {
    const prefix = z.flags.length > 0 ? (FLAG_PREFIXES[z.flags[0] ?? ''] ?? '') : ''
    return `${prefix}${z.quote}`
  })

  return sentences.join('. ').replace(/\.\./g, '.')
}

export function topZettels(result: CompressResult, n: number): Zettel[] {
  return [...result.zettels].sort((a, b) => b.weight - a.weight).slice(0, n)
}
