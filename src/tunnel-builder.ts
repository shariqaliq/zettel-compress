import type { Zettel, Tunnel, EntityIndex } from './types.js'

function intersection<T>(a: T[], b: T[]): T[] {
  const setB = new Set(b)
  return a.filter((x) => setB.has(x))
}

export function buildTunnels(zettels: Zettel[], entityIndex: EntityIndex): Tunnel[] {
  const tunnels: Tunnel[] = []

  for (let i = 0; i < zettels.length; i++) {
    for (let j = i + 1; j < zettels.length; j++) {
      const a = zettels[i]
      const b = zettels[j]
      if (!a || !b) continue

      const sharedEntities = intersection(a.entities, b.entities)
      const sharedTopics = intersection(a.topics, b.topics)

      if (sharedEntities.length >= 2 || sharedTopics.length >= 3) {
        let label: string

        if (sharedEntities.length >= 2) {
          label = sharedEntities
            .slice(0, 3)
            .map((name) => entityIndex.nameToCode[name] ?? name.slice(0, 3).toUpperCase())
            .join('+')
        } else {
          label = sharedTopics.slice(0, 2).join('_')
        }

        tunnels.push({ from: a.id, to: b.id, label })
      }
    }
  }

  return tunnels.sort((a, b) => a.from.localeCompare(b.from))
}
