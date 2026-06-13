/**
 * Rule-based temporal expression extractor and normalizer.
 *
 * Extracts ISO-8601 dates from text using three strategies, in priority order:
 *   1. Absolute dates in the text ("8 May 2023", "June 2023", "2023-06-08")
 *   2. Relative expressions resolved against the nearest preceding absolute
 *      anchor in the text ("yesterday" → anchor - 1 day)
 *   3. Fallback to the session date provided in CompressOptions.date
 *
 * Output is always one of: "YYYY-MM-DD", "YYYY-MM", or "YYYY".
 * Returns undefined when no date signal is found.
 *
 * Zero dependencies. Deterministic. Edge-safe.
 */

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
}

const MONTH_NAMES = Object.keys(MONTHS).join('|')

// ── Parsed date (internal) ────────────────────────────────────────────────────

interface ParsedDate {
  year: number
  month?: number  // 1–12
  day?: number    // 1–31
}

function toISO(d: ParsedDate): string {
  if (d.month === undefined) return String(d.year)
  const mm = String(d.month).padStart(2, '0')
  if (d.day === undefined) return `${d.year}-${mm}`
  const dd = String(d.day).padStart(2, '0')
  return `${d.year}-${mm}-${dd}`
}

function addDays(d: ParsedDate, n: number): ParsedDate {
  if (d.month === undefined || d.day === undefined) return d
  const dt = new Date(d.year, d.month - 1, d.day + n)
  return { year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate() }
}

function addWeeks(d: ParsedDate, n: number): ParsedDate {
  return addDays(d, n * 7)
}

function addMonths(d: ParsedDate, n: number): ParsedDate {
  if (d.month === undefined) return { year: d.year + Math.floor(n / 12) }
  const m = d.month - 1 + n
  const result: ParsedDate = {
    year: d.year + Math.floor(m / 12),
    month: ((m % 12) + 12) % 12 + 1,
  }
  if (d.day !== undefined) result.day = d.day
  return result
}

// ── Absolute date patterns ────────────────────────────────────────────────────

// "8 May 2023", "8th May 2023", "8 May, 2023"
const RE_DAY_MONTH_YEAR = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES})[,.]?\\s*(\\d{4})\\b`,
  'gi',
)

// "May 8 2023", "May 8th 2023", "May 8, 2023"
const RE_MONTH_DAY_YEAR = new RegExp(
  `\\b(${MONTH_NAMES})\\s+(\\d{1,2})(?:st|nd|rd|th)?[,.]?\\s*(\\d{4})\\b`,
  'gi',
)

// "May 2023", "June 2023" — month + year only
const RE_MONTH_YEAR = new RegExp(
  `\\b(${MONTH_NAMES})\\s+(\\d{4})\\b`,
  'gi',
)

// ISO: "2023-06-08"
const RE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g

// Bare year: "in 2023", "since 2021", "back in 2019"
const RE_BARE_YEAR = /\b(?:in|since|back in|around|during|of|from)\s+(\d{4})\b/gi

// Parenthesized timestamps like "(1:56 pm on 8 May, 2023)" from LoCoMo
const RE_PAREN_TIMESTAMP = new RegExp(
  `\\(.*?(?:\\bon\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES})[,.]?\\s*(\\d{4}).*?\\)`,
  'gi',
)

interface AbsoluteHit {
  index: number
  end: number      // exclusive end in source text (for overlap dedup)
  date: ParsedDate
}

// Specificity score: day+month+year > month+year > year
function specificity(d: ParsedDate): number {
  return (d.day !== undefined ? 4 : 0) + (d.month !== undefined ? 2 : 0) + 1
}

function extractAbsolutes(text: string): AbsoluteHit[] {
  const raw: AbsoluteHit[] = []

  const addRaw = (index: number, end: number, date: ParsedDate) => {
    raw.push({ index, end, date })
  }

  // highest-specificity patterns first
  for (const re of [RE_PAREN_TIMESTAMP, RE_DAY_MONTH_YEAR, RE_MONTH_DAY_YEAR]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      let day: number, monthName: string, year: number
      if (re === RE_PAREN_TIMESTAMP || re === RE_DAY_MONTH_YEAR) {
        day = parseInt(m[1]!, 10)
        monthName = m[2]!.toLowerCase()
        year = parseInt(m[3]!, 10)
      } else {
        monthName = m[1]!.toLowerCase()
        day = parseInt(m[2]!, 10)
        year = parseInt(m[3]!, 10)
      }
      const month = MONTHS[monthName]
      if (month && year >= 1900 && year <= 2100 && day >= 1 && day <= 31) {
        addRaw(m.index, m.index + m[0].length, { year, month, day })
      }
    }
  }

  RE_ISO.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE_ISO.exec(text)) !== null) {
    const year = parseInt(m[1]!, 10), month = parseInt(m[2]!, 10), day = parseInt(m[3]!, 10)
    if (year >= 1900 && year <= 2100) addRaw(m.index, m.index + m[0].length, { year, month, day })
  }

  RE_MONTH_YEAR.lastIndex = 0
  while ((m = RE_MONTH_YEAR.exec(text)) !== null) {
    const month = MONTHS[m[1]!.toLowerCase()]
    const year = parseInt(m[2]!, 10)
    if (month && year >= 1900 && year <= 2100) addRaw(m.index, m.index + m[0].length, { year, month })
  }

  RE_BARE_YEAR.lastIndex = 0
  while ((m = RE_BARE_YEAR.exec(text)) !== null) {
    const year = parseInt(m[1]!, 10)
    if (year >= 1900 && year <= 2100) addRaw(m.index, m.index + m[0].length, { year })
  }

  // Deduplicate overlapping spans: keep the most specific hit per overlapping group.
  // Sort by index, then for each hit discard it if a more-specific hit already covers
  // the same text position.
  raw.sort((a, b) => a.index - b.index || b.end - a.end)
  const hits: AbsoluteHit[] = []
  for (const h of raw) {
    const overlaps = hits.some(
      (kept) => h.index < kept.end && h.end > kept.index &&
        specificity(kept.date) >= specificity(h.date),
    )
    if (!overlaps) hits.push(h)
  }

  return hits.sort((a, b) => a.index - b.index)
}

// ── Session anchor from CompressOptions.date ──────────────────────────────────

function parseSessionDate(date: string): ParsedDate | undefined {
  // ISO
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (iso) return { year: +iso[1]!, month: +iso[2]!, day: +iso[3]! }
  const isoM = /^(\d{4})-(\d{2})$/.exec(date)
  if (isoM) return { year: +isoM[1]!, month: +isoM[2]! }
  const isoY = /^(\d{4})$/.exec(date)
  if (isoY) return { year: +isoY[1]! }
  // Try the absolute extractor
  const hits = extractAbsolutes(date)
  return hits[0]?.date
}

// ── Relative expression resolver ──────────────────────────────────────────────

const WEEKDAY: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
}
const WEEKDAY_NAMES = Object.keys(WEEKDAY).join('|')

// Returns resolved ParsedDate or undefined if not a relative expression.
function resolveRelative(text: string, anchor: ParsedDate): ParsedDate | undefined {
  const t = text.toLowerCase()

  // "yesterday"
  if (/\byesterday\b/.test(t)) return addDays(anchor, -1)
  // "today" / "tonight"
  if (/\b(?:today|tonight)\b/.test(t)) return anchor
  // "tomorrow"
  if (/\btomorrow\b/.test(t)) return addDays(anchor, 1)

  // "last week" / "next week" / "this week"
  if (/\blast\s+week\b/.test(t)) return addWeeks(anchor, -1)
  if (/\bnext\s+week\b/.test(t)) return addWeeks(anchor, 1)
  if (/\bthis\s+week\b/.test(t)) return anchor

  // "last month" / "next month" / "this month"
  if (/\blast\s+month\b/.test(t)) return addMonths(anchor, -1)
  if (/\bnext\s+month\b/.test(t)) return addMonths(anchor, 1)
  if (/\bthis\s+month\b/.test(t)) return anchor.month ? { year: anchor.year, month: anchor.month } : anchor

  // "last year" / "next year"
  if (/\blast\s+year\b/.test(t)) return { year: anchor.year - 1 }
  if (/\bnext\s+year\b/.test(t)) return { year: anchor.year + 1 }

  // "N days ago" / "N days from now"
  let m = /\b(\d+)\s+days?\s+ago\b/.exec(t)
  if (m) return addDays(anchor, -parseInt(m[1]!, 10))
  m = /\b(\d+)\s+days?\s+(?:from now|later)\b/.exec(t)
  if (m) return addDays(anchor, parseInt(m[1]!, 10))

  // "N weeks ago" / "in N weeks"
  m = /\b(\d+)\s+weeks?\s+ago\b/.exec(t)
  if (m) return addWeeks(anchor, -parseInt(m[1]!, 10))
  m = /\bin\s+(\d+)\s+weeks?\b/.exec(t)
  if (m) return addWeeks(anchor, parseInt(m[1]!, 10))

  // "N months ago" / "in N months"
  m = /\b(\d+)\s+months?\s+ago\b/.exec(t)
  if (m) return addMonths(anchor, -parseInt(m[1]!, 10))
  m = /\bin\s+(\d+)\s+months?\b/.exec(t)
  if (m) return addMonths(anchor, parseInt(m[1]!, 10))

  // "last Monday" / "next Friday" / "this Tuesday"
  const wdRe = new RegExp(`\\b(last|next|this)\\s+(${WEEKDAY_NAMES})\\b`)
  const wm = wdRe.exec(t)
  if (wm && anchor.day !== undefined && anchor.month !== undefined) {
    const dir = wm[1]!
    const targetWd = WEEKDAY[wm[2]!]!
    const anchorDate = new Date(anchor.year, anchor.month - 1, anchor.day)
    const anchorWd = anchorDate.getDay()
    let delta = targetWd - anchorWd
    if (dir === 'last') {
      if (delta >= 0) delta -= 7
    } else if (dir === 'next') {
      if (delta <= 0) delta += 7
    }
    // 'this' keeps the nearest (could be 0)
    return addDays(anchor, delta)
  }

  // "the Sunday before <date>" / "the week before <date>" — handled by
  // extractAbsolutes finding the anchor date; relative prefix adjusts it
  m = /\bthe\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+before\b/.exec(t)
  if (m) return addDays(anchor, -7)
  m = /\bthe\s+week\s+before\b/.exec(t)
  if (m) return addWeeks(anchor, -1)
  m = /\bthe\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+after\b/.exec(t)
  if (m) return addDays(anchor, 7)
  m = /\bthe\s+week\s+after\b/.exec(t)
  if (m) return addWeeks(anchor, 1)

  return undefined
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Find the best ISO date for a chunk of text.
 *
 * Strategy (priority order):
 * 1. Most specific absolute date found in the chunk text itself
 * 2. Relative expression resolved against the nearest preceding absolute date
 *    anchor found anywhere in the full document text (passed as `docContext`)
 * 3. Relative expression resolved against the session anchor (sessionDate)
 * 4. The session anchor itself if no expression but anchor is known
 *
 * Returns undefined when there is no usable signal.
 */
export function resolveChunkDate(
  chunkText: string,
  sessionDate: string | undefined,
  docContext: AbsoluteHit[],
  chunkStart: number,
): string | undefined {
  // 1. Absolute date in the chunk itself — most specific wins
  const localHits = extractAbsolutes(chunkText)
  if (localHits.length > 0) {
    // prefer the most specific (day > month > year)
    const best = localHits.reduce((a, b) => {
      const scoreA = (a.date.day !== undefined ? 2 : 0) + (a.date.month !== undefined ? 1 : 0)
      const scoreB = (b.date.day !== undefined ? 2 : 0) + (b.date.month !== undefined ? 1 : 0)
      return scoreB > scoreA ? b : a
    })
    return toISO(best.date)
  }

  // 2. Resolve relative expressions against the nearest preceding absolute
  //    anchor in the document
  const sessionAnchor = sessionDate ? parseSessionDate(sessionDate) : undefined
  const precedingHits = docContext.filter(h => h.index < chunkStart)
  const nearestAnchor = precedingHits.length > 0
    ? precedingHits[precedingHits.length - 1]!.date
    : sessionAnchor

  if (nearestAnchor) {
    const resolved = resolveRelative(chunkText, nearestAnchor)
    if (resolved) return toISO(resolved)
  }

  // 3. Session anchor as fallback
  if (sessionAnchor) return toISO(sessionAnchor)

  return undefined
}

/**
 * Pre-scan the full document for absolute date anchors. Call once per
 * compress() invocation and pass the result to resolveChunkDate() for each
 * chunk.
 */
export function scanDocumentDates(text: string): AbsoluteHit[] {
  return extractAbsolutes(text)
}
