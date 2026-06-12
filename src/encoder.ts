import type {
  CompressResult,
  Zettel,
  Tunnel,
  EntityIndex,
  EmotionName,
  FlagName,
  DecodeOptions,
} from './types.js'
import { ALL_EMOTIONS, ALL_FLAGS } from './types.js'

const EMOTION_SET = new Set<string>(ALL_EMOTIONS)
const FLAG_SET = new Set<string>(ALL_FLAGS)

// ── escaping ──────────────────────────────────────────────────────────────────
// AAAK v2 is line-oriented with | field separators; every reserved character
// inside a value is backslash-escaped so the round-trip is exact

function escapeQuote(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
}

function escapeField(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
}

function escapeTopic(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/\|/g, '\\|')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
}

function escapeEntityName(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/=/g, '\\=')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
}

function unescapeText(s: string): string {
  return s.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c))
}

function splitUnescaped(s: string, sep: string): string[] {
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (ch === '\\' && i + 1 < s.length) {
      cur += ch + s[i + 1]!
      i++
      continue
    }
    if (ch === sep) {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  parts.push(cur)
  return parts
}

// ── encode ────────────────────────────────────────────────────────────────────

export function encodeZettelLine(z: Zettel, entityIndex: EntityIndex): string {
  const codes = z.entities
    .map((name) => entityIndex.nameToCode[name] ?? name.slice(0, 3).toUpperCase())
    .join('+')

  const topics = z.topics.map(escapeTopic).join(',')
  const weight = z.weight.toFixed(2)
  const emotions = z.emotions.join('+')
  const flags = z.flags.join('+')
  // optional trailing source-span field (start-end into the original text)
  const span =
    z.sourceStart !== undefined && z.sourceEnd !== undefined
      ? `|${z.sourceStart}-${z.sourceEnd}`
      : ''

  return `${z.id}:${codes}|${topics}|"${escapeQuote(z.quote)}"|${weight}|${emotions}|${flags}${span}`
}

export function encodeTunnelLine(t: Tunnel): string {
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

  const date = escapeField(result.meta?.date ?? '')
  const title = escapeField(result.meta?.title ?? '')
  const header = `FILE:${count}|${topCodes}|${date}|${title}|v2`

  const lines: string[] = [header]

  // E: lines carry the code→name index — without them, decode can never
  // recover entity names and the round-trip silently degrades to codes
  const codes = Object.keys(result.entityIndex.codeToName).sort()
  if (codes.length > 0) {
    const entries = codes.map(
      (c) => `${c}=${escapeEntityName(result.entityIndex.codeToName[c] ?? '')}`,
    )
    lines.push(`E:${entries.join(';')}`)
  }

  for (const z of result.zettels) lines.push(encodeZettelLine(z, result.entityIndex))
  for (const t of result.tunnels) lines.push(encodeTunnelLine(t))

  return lines.join('\n')
}

// ── decode ────────────────────────────────────────────────────────────────────

function parseEntityLine(body: string, entityIndex: EntityIndex): void {
  for (const entry of splitUnescaped(body, ';')) {
    if (entry.length === 0) continue
    const kv = splitUnescaped(entry, '=')
    if (kv.length < 2) continue
    const code = unescapeText(kv[0] ?? '')
    const name = unescapeText(kv.slice(1).join('='))
    if (code.length === 0) continue
    entityIndex.codeToName[code] = name
    entityIndex.nameToCode[name] = code
  }
}

interface ParseContext {
  entityIndex: EntityIndex
  warn: (msg: string) => void
}

function validateLists(
  emotionsStr: string,
  flagsStr: string,
  id: string,
  ctx: ParseContext,
): { emotions: EmotionName[]; flags: FlagName[] } {
  const emotions: EmotionName[] = []
  for (const e of emotionsStr.split('+').filter(Boolean)) {
    if (EMOTION_SET.has(e)) emotions.push(e as EmotionName)
    else ctx.warn(`zettel ${id}: unknown emotion '${e}' dropped`)
  }
  const flags: FlagName[] = []
  for (const f of flagsStr.split('+').filter(Boolean)) {
    if (FLAG_SET.has(f)) flags.push(f as FlagName)
    else ctx.warn(`zettel ${id}: unknown flag '${f}' dropped`)
  }
  return { emotions, flags }
}

function parseZettelV2(line: string, ctx: ParseContext): Zettel | null {
  const colonIdx = line.indexOf(':')
  if (colonIdx === -1) return null
  const id = line.slice(0, colonIdx)
  if (!/^\d+$/.test(id)) return null

  const rest = line.slice(colonIdx + 1)
  const quoteStart = rest.indexOf('"')
  if (quoteStart === -1) return null

  // scan for the closing quote, honoring backslash escapes
  let quoteEnd = -1
  for (let i = quoteStart + 1; i < rest.length; i++) {
    if (rest[i] === '\\') {
      i++
      continue
    }
    if (rest[i] === '"') {
      quoteEnd = i
      break
    }
  }
  if (quoteEnd === -1) return null

  const quote = unescapeText(rest.slice(quoteStart + 1, quoteEnd))
  const before = splitUnescaped(rest.slice(0, quoteStart), '|')
  const after = splitUnescaped(rest.slice(quoteEnd + 1), '|')

  const codes = before[0] ?? ''
  const topicsStr = before[1] ?? ''
  const weightStr = after[1] ?? ''
  const weight = parseFloat(weightStr)
  if (isNaN(weight)) return null

  const { emotions, flags } = validateLists(after[2] ?? '', after[3] ?? '', id, ctx)
  const topics = splitUnescaped(topicsStr, ',').filter(Boolean).map(unescapeText)

  const entities = codes
    .split('+')
    .filter(Boolean)
    .map((code) => {
      const name = ctx.entityIndex.codeToName[code]
      if (name === undefined) {
        ctx.warn(`zettel ${id}: entity code '${code}' missing from index`)
        return code
      }
      return name
    })

  const spanMatch = /^(\d+)-(\d+)$/.exec(after[4] ?? '')

  return {
    id,
    entities,
    topics,
    quote,
    weight: Math.round(weight * 100) / 100,
    emotions,
    flags,
    ...(spanMatch
      ? { sourceStart: parseInt(spanMatch[1]!, 10), sourceEnd: parseInt(spanMatch[2]!, 10) }
      : {}),
  }
}

// Legacy v1 lines: no escaping, topics joined by '_', no entity index
function parseZettelV1(line: string, ctx: ParseContext): Zettel | null {
  const colonIdx = line.indexOf(':')
  if (colonIdx === -1) return null
  const id = line.slice(0, colonIdx)
  if (!/^\d+$/.test(id)) return null

  const rest = line.slice(colonIdx + 1)
  const quoteStart = rest.indexOf('"')
  const quoteEnd = rest.lastIndexOf('"')
  if (quoteStart === -1 || quoteStart === quoteEnd) return null

  const quote = rest.slice(quoteStart + 1, quoteEnd)
  const beforeParts = rest.slice(0, quoteStart).split('|')
  const afterParts = rest.slice(quoteEnd + 1).split('|')

  const codes = beforeParts[0] ?? ''
  const topics = beforeParts[1] ?? ''
  const weight = parseFloat(afterParts[1] ?? '0')
  if (isNaN(weight)) return null

  const { emotions, flags } = validateLists(afterParts[2] ?? '', afterParts[3] ?? '', id, ctx)

  const entityNames = codes
    ? codes.split('+').filter(Boolean).map((code) => ctx.entityIndex.codeToName[code] ?? code)
    : []

  // v1 had no E: lines — rebuild a code-keyed index from the zettel lines
  if (codes) {
    for (const code of codes.split('+').filter(Boolean)) {
      if (!ctx.entityIndex.codeToName[code]) {
        ctx.entityIndex.codeToName[code] = code
        ctx.entityIndex.nameToCode[code] = code
      }
    }
  }

  return {
    id,
    entities: entityNames,
    topics: topics ? topics.split('_').filter(Boolean) : [],
    quote,
    weight: Math.round(weight * 100) / 100,
    emotions,
    flags,
  }
}

export function decode(aaak: string, options?: DecodeOptions): CompressResult {
  const strict = options?.strict ?? false
  const warnings: string[] = []
  const warn = (msg: string): void => {
    if (strict) throw new Error(`AAAK decode: ${msg}`)
    warnings.push(msg)
  }

  const lines = aaak.split('\n').map((l) => l.trim()).filter(Boolean)
  const entityIndex: EntityIndex = { nameToCode: {}, codeToName: {} }
  const ctx: ParseContext = { entityIndex, warn }
  const zettels: Zettel[] = []
  const tunnels: Tunnel[] = []
  let date: string | undefined
  let title: string | undefined
  let declaredCount: number | null = null
  let v2 = false
  let inputLength = 0

  for (const line of lines) {
    if (line.startsWith('FILE:')) {
      const parts = splitUnescaped(line.slice(5), '|')
      v2 = parts[4] === 'v2'
      const count = parseInt(parts[0] ?? '', 10)
      if (!isNaN(count)) declaredCount = count
      date = parts[2] ? unescapeText(parts[2]) : undefined
      title = parts[3] ? unescapeText(parts[3]) : undefined
      continue
    }

    if (line.startsWith('E:')) {
      parseEntityLine(line.slice(2), entityIndex)
      continue
    }

    if (line.startsWith('T:')) {
      const body = line.slice(2)
      const arrowIdx = body.indexOf('<->')
      if (arrowIdx === -1) {
        warn(`malformed tunnel line skipped: '${line.slice(0, 40)}'`)
        continue
      }
      const pipeIdx = body.indexOf('|')
      const from = body.slice(0, arrowIdx)
      const to = pipeIdx !== -1 ? body.slice(arrowIdx + 3, pipeIdx) : body.slice(arrowIdx + 3)
      const label = pipeIdx !== -1 ? body.slice(pipeIdx + 1) : ''
      tunnels.push({ from, to, label })
      continue
    }

    const z = v2 ? parseZettelV2(line, ctx) : parseZettelV1(line, ctx)
    if (z) {
      zettels.push(z)
      inputLength += z.quote.length
    } else {
      warn(`malformed zettel line skipped: '${line.slice(0, 40)}'`)
    }
  }

  if (declaredCount !== null && declaredCount !== zettels.length) {
    warn(`header declares ${declaredCount} zettels but ${zettels.length} parsed`)
  }

  // Rebuild nameToCode from codeToName
  for (const [code, name] of Object.entries(entityIndex.codeToName)) {
    entityIndex.nameToCode[name] = code
  }

  const meta: CompressResult['meta'] = { inputLength, chunkCount: zettels.length }
  if (date !== undefined) meta.date = date
  if (title !== undefined) meta.title = title
  if (warnings.length > 0) meta.warnings = warnings

  return { zettels, tunnels, entityIndex, meta }
}
