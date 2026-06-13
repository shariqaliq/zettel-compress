import type { Zettel, Tunnel, EntityIndex } from './types.js'
import { minhashSignature, lshCandidatePairs } from './minhash.js'

// Above this size, candidate pairs come from LSH instead of all-pairs —
// below it, exact enumeration is both faster and has perfect recall
const LSH_ACTIVATION = 500

// Topics may now be multi-word phrases ("connection pool", "rate limiting").
// Jaccard on the phrase strings themselves gives zero overlap between
// "connection pool" and "connection timeout" even though "connection" is shared.
// We expand each phrase into its component tokens and compute Jaccard over the
// union of all tokens, so partial phrase overlap is properly weighted.
function phraseTokens(topics: string[]): Set<string> {
  const tokens = new Set<string>()
  for (const t of topics) {
    for (const word of t.split(/\s+/)) {
      if (word.length >= 2) tokens.add(word)
    }
  }
  return tokens
}

function jaccardTopics(a: string[], b: string[]): number {
  const tokA = phraseTokens(a)
  const tokB = phraseTokens(b)
  if (tokA.size === 0 || tokB.size === 0) return 0
  let inter = 0
  for (const t of tokA) if (tokB.has(t)) inter++
  const union = tokA.size + tokB.size - inter
  return union > 0 ? inter / union : 0
}

function intersection<T>(a: T[], b: T[]): T[] {
  const setB = new Set(b)
  return a.filter((x) => setB.has(x))
}

function candidatePairs(zettels: Zettel[]): Array<[number, number]> {
  const n = zettels.length
  if (n <= LSH_ACTIVATION) {
    const pairs: Array<[number, number]> = []
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) pairs.push([i, j])
    }
    return pairs
  }
  // LSH path: signatures over the same tokens the exact scorer uses, so a
  // candidate hit always corresponds to real topic/entity overlap. Misses
  // are possible for weak similarities — the trade for ~O(n) at scale.
  // Expand phrase topics into tokens before hashing so "connection pool" and
  // "connection timeout" share the "connection" token in the signature
  const signatures = zettels.map((z) =>
    minhashSignature([...phraseTokens(z.topics), ...z.entities]),
  )
  return lshCandidatePairs(signatures)
}

export function buildTunnels(
  zettels: Zettel[],
  entityIndex: EntityIndex,
  threshold = 0.3,
  topK = 3,
  verboseLabels = false,
): Tunnel[] {
  const entityLabel = (name: string): string =>
    verboseLabels ? name : (entityIndex.nameToCode[name] ?? name.slice(0, 3).toUpperCase())
  // Collect candidate (i, j, score, tunnel) pairs, then verify exactly
  const candidates: Array<{ i: number; j: number; score: number; tunnel: Tunnel }> = []

  for (const [i, j] of candidatePairs(zettels)) {
    const a = zettels[i]
    const b = zettels[j]
    if (!a || !b) continue

    const sharedEntities = intersection(a.entities, b.entities)
    // Entity overlap contributes to score: each shared entity = 1 unit in union
    const entityScore =
      sharedEntities.length > 0
        ? sharedEntities.length / (a.entities.length + b.entities.length - sharedEntities.length || 1)
        : 0

    const topicScore = jaccardTopics(a.topics, b.topics)

    // Combined score: weight entity matches slightly higher
    const score = Math.max(entityScore * 1.2, topicScore)
    if (score < threshold) continue

    let label: string
    if (sharedEntities.length >= 2) {
      label = sharedEntities.slice(0, 3).map(entityLabel).join('+')
    } else {
      // Prefer exact phrase matches for the label; fall back to shared tokens
      // across all topics (needed when phrases don't match exactly but share words)
      const sharedPhrases = intersection(a.topics, b.topics)
      if (sharedPhrases.length > 0) {
        const labelParts = sharedPhrases.slice(0, 2).join('_')
        label = sharedEntities.length === 1
          ? `${sharedEntities[0]}_${labelParts}`.replace(/^_+|_+$/g, '')
          : labelParts
      } else {
        // shared token fallback: pick up to 2 tokens that appear in both sides
        const tokA = phraseTokens(a.topics)
        const tokB = phraseTokens(b.topics)
        const sharedTok = [...tokA].filter((t) => tokB.has(t)).slice(0, 2)
        label = sharedTok.length > 0
          ? sharedTok.join('_')
          : (sharedEntities[0] ?? '')
      }
    }

    candidates.push({ i, j, score, tunnel: { from: a.id, to: b.id, label } })
  }

  // Top-K per zettel: track how many tunnels each zettel has been assigned
  candidates.sort((a, b) => b.score - a.score)
  const usedCount = new Array<number>(zettels.length).fill(0)
  const accepted: Tunnel[] = []

  for (const { i, j, tunnel } of candidates) {
    if ((usedCount[i] ?? 0) < topK && (usedCount[j] ?? 0) < topK) {
      accepted.push(tunnel)
      usedCount[i] = (usedCount[i] ?? 0) + 1
      usedCount[j] = (usedCount[j] ?? 0) + 1
    }
  }

  return accepted.sort((a, b) => a.from.localeCompare(b.from))
}
