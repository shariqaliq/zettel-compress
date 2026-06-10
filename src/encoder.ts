import type { CompressResult, Zettel, Tunnel, EntityIndex } from './types.js'
import type { EmotionName, FlagName } from './types.js'

function zettelToLine(z: Zettel, entityIndex: EntityIndex): string {
  const codes = z.entities
    .map((name) => entityIndex.nameToCode[name] ?? name.slice(0, 3).toUpperCase())
    .join('+')

  const topics = z.topics.join('_')
  const weight = z.weight.toFixed(2)
  const emotions = z.emotions.join('+')
  const flags = z.flags.join('+')

  return `${z.id}:${codes}|${topics}|"${z.quote}"|${weight}|${emotions}|${flags}`
}

function tunnelToLine(t: Tunnel): string {
  return `T:${t.from}<->${t.to}|${t.label}`
}

export function encode(result: CompressResult): string {
  const count = String(result.zettels.length).padStart(3, '0')

  // Top 3 entities by first appearance across zettels
  const seenEntities: string[] = []
  for (const z of result.zettels) {
    for (const e of z.entities) {
      if (!seenEntities.includes(e)) seenEntities.push(e)
      if (seenEntities.length >= 3) break
    }
    if (seenEntities.length >= 3) break
  }
  const topCodes = seenEntities
    .map((name) => result.entityIndex.nameToCode[name] ?? name.slice(0, 3).toUpperCase())
    .join('+')

  const date = result.meta?.date ?? ''
  const title = result.meta?.title ?? ''
  const header = `FILE:${count}|${topCodes}|${date}|${title}`

  const lines: string[] = [header]
  for (const z of result.zettels) lines.push(zettelToLine(z, result.entityIndex))
  for (const t of result.tunnels) lines.push(tunnelToLine(t))

  return lines.join('\n')
}

function parseZettelLine(line: string, entityIndex: EntityIndex): Zettel | null {
  // format: <id>:<codes>|<topics>|"<quote>"|<weight>|<emotions>|<flags>
  const colonIdx = line.indexOf(':')
  if (colonIdx === -1) return null
  const id = line.slice(0, colonIdx)
  if (!/^\d+$/.test(id)) return null

  const rest = line.slice(colonIdx + 1)

  // Two-phase parse: find the "..." quote span first
  const quoteStart = rest.indexOf('"')
  const quoteEnd = rest.lastIndexOf('"')
  if (quoteStart === -1 || quoteStart === quoteEnd) return null

  const quote = rest.slice(quoteStart + 1, quoteEnd)
  const before = rest.slice(0, quoteStart) // <codes>|<topics>|
  const after = rest.slice(quoteEnd + 1)   // |<weight>|<emotions>|<flags>

  const beforeParts = before.split('|')
  const codes = beforeParts[0] ?? ''
  const topics = beforeParts[1] ?? ''

  const afterParts = after.split('|')
  // afterParts[0] is empty string (leading |)
  const weightStr = afterParts[1] ?? '0'
  const emotionsStr = afterParts[2] ?? ''
  const flagsStr = afterParts[3] ?? ''

  const weight = parseFloat(weightStr)
  const emotions = emotionsStr ? emotionsStr.split('+').filter(Boolean) as EmotionName[] : []
  const flagsList = flagsStr ? flagsStr.split('+').filter(Boolean) as FlagName[] : []
  const topicList = topics ? topics.split('_').filter(Boolean) : []

  // Resolve entity codes back to names
  const entityNames = codes
    ? codes.split('+').filter(Boolean).map((code) => entityIndex.codeToName[code] ?? code)
    : []

  // Also rebuild entityIndex from this line's codes
  if (codes) {
    for (const code of codes.split('+').filter(Boolean)) {
      if (!entityIndex.codeToName[code]) {
        entityIndex.codeToName[code] = code
        entityIndex.nameToCode[code] = code
      }
    }
  }

  return {
    id,
    entities: entityNames,
    topics: topicList,
    quote,
    weight: isNaN(weight) ? 0 : Math.round(weight * 100) / 100,
    emotions,
    flags: flagsList,
  }
}

export function decode(aaak: string): CompressResult {
  const lines = aaak.split('\n').map((l) => l.trim()).filter(Boolean)
  const entityIndex: EntityIndex = { nameToCode: {}, codeToName: {} }
  const zettels: Zettel[] = []
  const tunnels: Tunnel[] = []
  let date: string | undefined
  let title: string | undefined
  let inputLength = 0

  for (const line of lines) {
    if (line.startsWith('FILE:')) {
      const parts = line.slice(5).split('|')
      date = parts[2] || undefined
      title = parts[3] || undefined
      continue
    }

    if (line.startsWith('T:')) {
      // T:<from><-><to>|<label>
      const body = line.slice(2)
      const pipeIdx = body.indexOf('|')
      const arrowIdx = body.indexOf('<->')
      if (arrowIdx === -1) continue
      const from = body.slice(0, arrowIdx)
      const to = pipeIdx !== -1 ? body.slice(arrowIdx + 3, pipeIdx) : body.slice(arrowIdx + 3)
      const label = pipeIdx !== -1 ? body.slice(pipeIdx + 1) : ''
      tunnels.push({ from, to, label })
      continue
    }

    const z = parseZettelLine(line, entityIndex)
    if (z) {
      zettels.push(z)
      inputLength += z.quote.length
    }
  }

  // Rebuild nameToCode from codeToName
  for (const [code, name] of Object.entries(entityIndex.codeToName)) {
    entityIndex.nameToCode[name] = code
  }

  const meta: CompressResult['meta'] = { inputLength, chunkCount: zettels.length }
  if (date !== undefined) meta.date = date
  if (title !== undefined) meta.title = title

  return { zettels, tunnels, entityIndex, meta }
}
