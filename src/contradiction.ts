/**
 * Deterministic contradiction detection over a compressed result.
 *
 * A contradiction is flagged when two DECISION-flagged zettels from different
 * chunks share an entity or topic AND show one of three conflict signals:
 *
 *   1. Negation flip  — one quote affirms, the other negates the same predicate
 *                       ("we will use Redis" → "we decided against Redis")
 *   2. Value change   — same subject + decision verb, but different object value
 *                       ("ship Friday" → "ship Monday")
 *   3. Antonym pair   — a core content word in one quote has a known antonym
 *                       in the other (approve/reject, start/stop, etc.)
 *
 * Only cross-chunk pairs are considered (same-chunk debate is not a contradiction).
 * Later zettels (higher id) are treated as superseding earlier ones.
 *
 * Zero dependencies. Deterministic. Edge-safe.
 */

import type { CompressResult, Zettel } from './types.js'

export interface Contradiction {
  /** Earlier (superseded) zettel id */
  earlier: string
  /** Later (superseding) zettel id */
  later: string
  /** Shared entity or topic that links the two zettels */
  sharedTopic: string
  /** What kind of conflict signal fired */
  signal: 'negation-flip' | 'value-change' | 'antonym'
  /** One-line human-readable summary */
  summary: string
}

// ── NegEx-style negation scope ────────────────────────────────────────────────

const NEGATION_CUES = [
  'not', "n't", 'no', 'never', 'neither', 'nor', 'without', 'against',
  'decided against', 'ruled out', 'rejected', 'cancelled', 'cancelled',
  'dropped', 'abandoned', 'reversed', 'undone', 'revoked', 'scrapped',
]

// Termination boundaries reset negation scope
const NEG_TERMINATORS = /\b(but|however|although|though|except|yet|still)\b/i

function isNegated(text: string): boolean {
  const lower = text.toLowerCase()
  // Check multi-word cues first
  for (const cue of NEGATION_CUES) {
    if (lower.includes(cue)) {
      // Scope: negation must not be terminated before the main predicate
      const cueIdx = lower.indexOf(cue)
      const after = lower.slice(cueIdx, cueIdx + 60)
      if (!NEG_TERMINATORS.test(after)) return true
    }
  }
  return false
}

// ── Value extraction ──────────────────────────────────────────────────────────

// Decision verbs whose direct object is the "value" being decided
const DECISION_VERBS = /\b(?:use|deploy|ship|launch|release|set|choose|pick|adopt|migrate|move|switch|schedule|plan|commit|decide|target|fix|cap)\b/gi

// Extract the noun phrase immediately following a decision verb (up to 5 tokens)
function extractValue(text: string): string | undefined {
  DECISION_VERBS.lastIndex = 0
  const m = DECISION_VERBS.exec(text)
  if (!m) return undefined
  const after = text.slice(m.index + m[0].length).trim()
  // take up to 5 words, stopping at punctuation or conjunction
  return after.split(/[,;.!?\n]|(?:\b(?:and|or|but|because|so|if)\b)/)[0]?.trim().toLowerCase().slice(0, 60)
}

// ── Antonym pairs ─────────────────────────────────────────────────────────────

const ANTONYM_PAIRS: [string, string][] = [
  ['approve', 'reject'], ['accept', 'reject'], ['accept', 'decline'],
  ['start', 'stop'], ['begin', 'end'], ['enable', 'disable'],
  ['add', 'remove'], ['include', 'exclude'], ['keep', 'drop'],
  ['increase', 'decrease'], ['expand', 'shrink'], ['upgrade', 'downgrade'],
  ['open', 'close'], ['open', 'block'], ['allow', 'deny'],
  ['proceed', 'cancel'], ['continue', 'abort'], ['deploy', 'rollback'],
  ['ship', 'revert'], ['merge', 'revert'], ['push', 'revert'],
  ['yes', 'no'], ['true', 'false'], ['on', 'off'],
  ['confirmed', 'cancelled'], ['agreed', 'disagreed'],
  ['will', 'won\'t'], ['shall', 'shan\'t'],
]

// Build a lookup: word → set of its antonyms
const ANTONYM_MAP = new Map<string, Set<string>>()
for (const [a, b] of ANTONYM_PAIRS) {
  if (!ANTONYM_MAP.has(a)) ANTONYM_MAP.set(a, new Set())
  if (!ANTONYM_MAP.has(b)) ANTONYM_MAP.set(b, new Set())
  ANTONYM_MAP.get(a)!.add(b)
  ANTONYM_MAP.get(b)!.add(a)
}

function hasAntonymConflict(textA: string, textB: string): string | undefined {
  const tokensA = textA.toLowerCase().split(/\W+/).filter(Boolean)
  const tokensB = new Set(textB.toLowerCase().split(/\W+/).filter(Boolean))
  for (const t of tokensA) {
    const antonyms = ANTONYM_MAP.get(t)
    if (!antonyms) continue
    for (const ant of antonyms) {
      if (tokensB.has(ant)) return `${t}/${ant}`
    }
  }
  return undefined
}

// ── Shared topic/entity overlap ───────────────────────────────────────────────

function sharedKey(a: Zettel, b: Zettel): string | undefined {
  // Entities take priority — they are more specific
  for (const e of a.entities) {
    if (b.entities.includes(e)) return e
  }
  // Then topics
  for (const t of a.topics) {
    if (b.topics.includes(t) && t.length > 3) return t
  }
  return undefined
}

// ── Short summary ─────────────────────────────────────────────────────────────

function makeSummary(
  a: Zettel,
  b: Zettel,
  signal: Contradiction['signal'],
  shared: string,
  textA?: string,
  textB?: string,
): string {
  const trimA = (textA ?? a.quote).slice(0, 60).replace(/\s+/g, ' ')
  const trimB = (textB ?? b.quote).slice(0, 60).replace(/\s+/g, ' ')
  const dateA = a.resolvedDate ? ` (${a.resolvedDate})` : ''
  const dateB = b.resolvedDate ? ` (${b.resolvedDate})` : ''
  return `[${shared}] "${trimA}"${dateA} → "${trimB}"${dateB} (${signal})`
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get the text to scan for contradiction signals on a zettel.
 *
 * The chunker overlaps chunks, so chunk N's sourceStart may be earlier than
 * chunk N-1's sourceEnd. The "unique" content of chunk N is the slice from the
 * previous chunk's sourceEnd to this chunk's sourceEnd (the non-overlap tail).
 * If no source is available, fall back to the quote.
 */
function signalText(
  z: Zettel,
  prev: Zettel | undefined,
  source: string | undefined,
): string {
  if (source && z.sourceEnd !== undefined) {
    // unique tail: from the end of the previous chunk (or start) to our end
    const from = prev?.sourceEnd ?? 0
    const to = z.sourceEnd
    const tail = from < to ? source.slice(from, to).trim() : ''
    // if the tail is too short (< 20 chars), fall back to full source chunk
    if (tail.length >= 20) return tail
    return source.slice(z.sourceStart ?? 0, z.sourceEnd).trim() || z.quote
  }
  return z.quote
}

/**
 * Detect contradictions in a compressed result. Only DECISION-flagged zettels
 * from different source positions are compared. Returns contradictions sorted
 * by later zettel id (most recent first).
 */
export function detectContradictions(result: CompressResult): Contradiction[] {
  const source = result.meta?.source
  const decisions = result.zettels.filter((z) => z.flags.includes('DECISION'))
  const found: Contradiction[] = []

  // Build a map from zettel id to the previous zettel (for unique-text slicing)
  const allById = new Map(result.zettels.map((z) => [z.id, z]))
  function prevZettel(z: Zettel): Zettel | undefined {
    const prevId = String(parseInt(z.id, 10) - 1).padStart(3, '0')
    return allById.get(prevId)
  }

  for (let i = 0; i < decisions.length; i++) {
    for (let j = i + 1; j < decisions.length; j++) {
      const a = decisions[i]!
      const b = decisions[j]!

      // Pairs i < j from the outer loop already guarantee a.id < b.id.
      // Any two distinct DECISION zettels at different positions may contradict.
      if (parseInt(b.id, 10) <= parseInt(a.id, 10)) continue

      const shared = sharedKey(a, b)
      if (!shared) continue

      // Get the unique source text for each zettel (not just the shared quote)
      const textA = signalText(a, prevZettel(a), source)
      const textB = signalText(b, prevZettel(b), source)

      // Signal 1: negation flip — one chunk affirms, the other negates
      const negA = isNegated(textA)
      const negB = isNegated(textB)
      if (negA !== negB) {
        found.push({
          earlier: a.id,
          later: b.id,
          sharedTopic: shared,
          signal: 'negation-flip',
          summary: makeSummary(a, b, 'negation-flip', shared, textA, textB),
        })
        continue
      }

      // Signal 2: value change — both have a decision verb but different values.
      // Guard: the extracted phrases must have fewer than 80% overlapping tokens
      // so that near-identical objects ("the feature on Friday" vs "the feature
      // on Monday") count as value-change rather than identical decisions.
      const valA = extractValue(textA)
      const valB = extractValue(textB)
      const valsDiffer = (a: string, b: string): boolean => {
        if (a === b) return false
        const tA = new Set(a.split(/\s+/))
        const tB = new Set(b.split(/\s+/))
        let overlap = 0
        for (const t of tA) if (tB.has(t)) overlap++
        const jaccard = overlap / (tA.size + tB.size - overlap)
        return jaccard < 0.8
      }
      if (valA && valB && valsDiffer(valA, valB)) {
        found.push({
          earlier: a.id,
          later: b.id,
          sharedTopic: shared,
          signal: 'value-change',
          summary: makeSummary(a, b, 'value-change', shared, textA, textB),
        })
        continue
      }

      // Signal 3: antonym pair in content words
      const antPair = hasAntonymConflict(textA, textB)
      if (antPair) {
        found.push({
          earlier: a.id,
          later: b.id,
          sharedTopic: shared,
          signal: 'antonym',
          summary: makeSummary(a, b, 'antonym', shared, textA, textB),
        })
      }
    }
  }

  // Sort by later zettel id descending (most recent contradiction first)
  return found.sort((a, b) => b.later.localeCompare(a.later))
}
