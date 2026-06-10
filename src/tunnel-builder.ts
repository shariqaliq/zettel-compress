import type { Zettel, Tunnel, EntityIndex } from './types.js'

function jaccardTopics(a: string[], b: string[]): number {
  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  for (const t of setA) if (setB.has(t)) inter++
  const union = setA.size + setB.size - inter
  return union > 0 ? inter / union : 0
}

function intersection<T>(a: T[], b: T[]): T[] {
  const setB = new Set(b)
  return a.filter((x) => setB.has(x))
}

export function buildTunnels(
  zettels: Zettel[],
  entityIndex: EntityIndex,
  threshold = 0.3,
  topK = 3,
): Tunnel[] {
  // Collect all candidate (i, j, score, tunnel) pairs
  const candidates: Array<{ i: number; j: number; score: number; tunnel: Tunnel }> = []

  for (let i = 0; i < zettels.length; i++) {
    for (let j = i + 1; j < zettels.length; j++) {
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
        label = sharedEntities
          .slice(0, 3)
          .map((name) => entityIndex.nameToCode[name] ?? name.slice(0, 3).toUpperCase())
          .join('+')
      } else if (sharedEntities.length === 1) {
        const sharedTopics = intersection(a.topics, b.topics)
        label = sharedTopics.length > 0 ? sharedTopics.slice(0, 2).join('_') : (sharedEntities[0] ?? '')
      } else {
        const sharedTopics = intersection(a.topics, b.topics)
        label = sharedTopics.slice(0, 2).join('_')
      }

      candidates.push({ i, j, score, tunnel: { from: a.id, to: b.id, label } })
    }
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
