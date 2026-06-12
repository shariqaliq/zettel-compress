import type { Zettel } from './types.js'
import { minhashSignature, lshCandidatePairs, exactJaccard } from './minhash.js'

export function dedupeTokens(z: Zettel): Set<string> {
  const tokens = new Set<string>()
  for (const w of z.quote.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (w.length >= 2) tokens.add(w)
  }
  for (const t of z.topics) tokens.add(t.toLowerCase())
  for (const e of z.entities) tokens.add(e.toLowerCase())
  return tokens
}

const LSH_ACTIVATION = 500

function mergeInto(keep: Zettel, drop: Zettel): void {
  keep.entities = [...new Set([...keep.entities, ...drop.entities])].sort()
  keep.topics = [...new Set([...keep.topics, ...drop.topics])]
  if (drop.weight > keep.weight) keep.weight = drop.weight
  for (const e of drop.emotions) if (!keep.emotions.includes(e)) keep.emotions.push(e)
  for (const f of drop.flags) if (!keep.flags.includes(f)) keep.flags.push(f)
}

/**
 * Merge near-duplicate zettels (token-set Jaccard ≥ threshold) via
 * union-find, so transitive groups collapse together. The member with the
 * highest weight (lowest id on ties) survives and absorbs the others'
 * entities, topics, emotions, and flags. Order of survivors is preserved.
 */
export function dedupeZettels(zettels: Zettel[], threshold = 0.9): Zettel[] {
  const n = zettels.length
  if (n < 2) return zettels

  const tokenSets = zettels.map(dedupeTokens)

  let pairs: Array<[number, number]>
  if (n <= LSH_ACTIVATION) {
    pairs = []
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) pairs.push([i, j])
    }
  } else {
    pairs = lshCandidatePairs(tokenSets.map((t) => minhashSignature(t)))
  }

  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!
      x = parent[x]!
    }
    return x
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }

  let merged = false
  for (const [i, j] of pairs) {
    if (exactJaccard(tokenSets[i]!, tokenSets[j]!) >= threshold) {
      union(i, j)
      merged = true
    }
  }
  if (!merged) return zettels

  // pick each group's representative: highest weight, then lowest index
  const repOf = new Map<number, number>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const cur = repOf.get(root)
    if (cur === undefined || zettels[i]!.weight > zettels[cur]!.weight) repOf.set(root, i)
  }

  const out: Zettel[] = []
  const repInOrder = new Set(repOf.values())
  for (let i = 0; i < n; i++) {
    if (!repInOrder.has(i)) continue
    const rep = { ...zettels[i]! }
    for (let j = 0; j < n; j++) {
      if (j !== i && find(j) === find(i)) mergeInto(rep, zettels[j]!)
    }
    out.push(rep)
  }
  return out
}
