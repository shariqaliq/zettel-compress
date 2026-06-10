import type { CompressResult, Zettel } from './types.js'

const WAKE_UP_THRESHOLD = 0.85
const WAKE_UP_FLAGS = new Set(['ORIGIN', 'CORE', 'GENESIS'])
const FLAG_PREFIXES: Record<string, string> = {
  ORIGIN:    'Origin: ',
  CORE:      'Core: ',
  GENESIS:   'Genesis: ',
  DECISION:  'Decision: ',
  PIVOT:     'Pivot: ',
  TECHNICAL: 'Technical: ',
}

function isHighImportance(z: Zettel): boolean {
  return z.weight >= WAKE_UP_THRESHOLD || z.flags.some((f) => WAKE_UP_FLAGS.has(f))
}

export function wakeUp(result: CompressResult): string {
  const candidates = result.zettels
    .filter(isHighImportance)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)

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
