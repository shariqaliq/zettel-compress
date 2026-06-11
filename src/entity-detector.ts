import type { EntityIndex } from './types.js'

const STOP_LIST = new Set([
  'I', 'The', 'A', 'An', 'It', 'He', 'She', 'They', 'We', 'You',
  'But', 'And', 'Or', 'In', 'On', 'At', 'To', 'Of', 'For', 'With',
  'By', 'From', 'That', 'This', 'These', 'Those', 'When', 'Where',
  'Which', 'Who', 'What', 'How', 'Then', 'So', 'If', 'As', 'Up',
  'About', 'After', 'Before', 'Because', 'While', 'Although', 'Though',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
  'Its', 'My', 'Our', 'Their', 'His', 'Her', 'Your', 'Mr', 'Mrs', 'Dr',
  'Yes', 'No', 'Not', 'Just', 'Also', 'Very', 'All', 'Any', 'Some',
  'Now', 'Here', 'There', 'Today', 'Tomorrow', 'Yesterday',
  // job titles and roles — the role is not the person
  'CEO', 'CTO', 'CFO', 'COO', 'VP', 'Director', 'Manager', 'President',
  'Founder', 'Engineer', 'Developer', 'Lead', 'Admin',
  // generic conversation roles
  'User', 'Assistant', 'System', 'Bot', 'Agent', 'Human', 'AI',
  // document structure
  'Section', 'Chapter', 'Part', 'Appendix', 'Figure', 'Table', 'Page',
  'Step', 'Note', 'Example', 'Item', 'List', 'Summary', 'Overview',
  'Introduction', 'Conclusion', 'Paragraph',
  // Roman numerals
  'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII',
  // honorifics
  'Prof', 'Sir', 'Dame', 'Lord', 'Lady', 'Madam', 'Miss', 'Ms',
  // discourse and imperative sentence starters
  'Please', 'Thanks', 'Thank', 'Sorry', 'Hello', 'Hi', 'Hey', 'Okay', 'OK',
  'Sure', 'Done', 'Ready', 'Maybe', 'Perhaps', 'Actually', 'Basically',
  'Honestly', 'Anyway', 'Alright', 'Welcome', 'Finally', 'Meanwhile',
  'Overall', 'Instead', 'Otherwise', 'However', 'Therefore', 'Thus', 'Hence',
  'Moreover', 'Furthermore', 'Additionally', 'First', 'Second', 'Third',
  'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth',
  'Each', 'Every', 'Both', 'Phase',
  'Last', 'Once', 'Again', 'Currently', 'Recently', 'Previously',
  'Originally', 'Eventually', 'Generally', 'Specifically', 'Typically',
  'Unfortunately', 'Fortunately', 'Let', 'Lets',
  // verbs that routinely open sentences in conversations and changelogs
  'Added', 'Removed', 'Fixed', 'Updated', 'Changed', 'Created', 'Deleted',
  'Moved', 'Renamed', 'Bumped', 'Pushed', 'Pulled', 'Merged', 'Committed',
  'Deployed', 'Released', 'Tested', 'Ran', 'Used', 'Applied', 'Advised',
  'Asked', 'Agreed', 'Decided', 'Started', 'Finished', 'Completed',
  'Implemented', 'Refactored', 'Reviewed', 'Wrote', 'Built', 'Made', 'Did',
  'Said', 'Got', 'Went', 'Saw', 'Took', 'Came', 'Found', 'Sent', 'Told',
  'Gave', 'Thought', 'Knew', 'Check', 'Run', 'Use', 'Try', 'Make', 'Add',
  'Fix', 'Update', 'Remove', 'Install', 'Open', 'Close', 'Start', 'Stop',
  'Keep', 'Look', 'See', 'Go', 'Think', 'Consider', 'Ensure', 'Remember',
])

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Sentence-start capitalization alone is not evidence of a proper noun — any
// word gets capitalized there. A candidate survives if the text supports it:
// capitalized mid-sentence or used as a chat speaker label. Without that,
// it is dropped when the text also uses it lowercase (a common word) or when
// it is shaped like a capitalized verb (Added, Running).
function isLikelyEntity(name: string, text: string): boolean {
  const escaped = escapeRegExp(name)

  // capitalized after a lowercase word, digit, or comma — cannot be a sentence start
  if (new RegExp(`[a-z0-9,;)]\\s+${escaped}\\b`).test(text)) return true
  // chat speaker label: "Alice: we should ship"
  if (new RegExp(`(?:^|\\n)\\s*${escaped}\\s*:`).test(text)) return true

  // appears lowercase as a standalone word elsewhere — common word, not a name
  if (new RegExp(`\\b${escapeRegExp(name.toLowerCase())}\\b`).test(text)) return false
  // verb-shaped Capitalized token (-ed/-ing) with no supporting evidence
  if (/(?:ed|ing)$/.test(name) && name === name[0] + name.slice(1).toLowerCase()) return false

  return true
}

export function detectEntities(text: string, minFreq = 1): string[] {
  const tokens = text.split(/\s+/)
  const freq: Record<string, number> = {}

  for (const raw of tokens) {
    const token = raw.replace(/^[^\w]+|[^\w]+$/g, '').replace(/'s$/, '')
    if (token.length < 2) continue
    if (!/^[A-Z]/.test(token)) continue
    if (STOP_LIST.has(token)) continue
    freq[token] = (freq[token] ?? 0) + 1
  }

  return Object.entries(freq)
    .filter(([, count]) => count >= minFreq)
    .filter(([name]) => isLikelyEntity(name, text))
    .map(([name]) => name)
    .sort()
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])

function toCode(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, '').toUpperCase()
  if (letters.length === 0) return 'UNK'

  const first = letters[0] ?? 'X'
  const consonants = letters
    .slice(1)
    .split('')
    .filter((c) => !VOWELS.has(c.toLowerCase()))

  if (consonants.length >= 2) {
    return first + (consonants[0] ?? 'X') + (consonants[1] ?? 'X')
  }
  if (consonants.length === 1) {
    return first + (consonants[0] ?? 'X') + (letters[letters.length - 1] ?? 'X')
  }
  return (first + letters.slice(1, 3)).toUpperCase().padEnd(3, 'X')
}

export function buildEntityIndex(entities: string[]): EntityIndex {
  const index: EntityIndex = { nameToCode: {}, codeToName: {} }
  extendEntityIndex(index, entities)
  return index
}

/**
 * Add new names to an existing index without changing any assigned code —
 * the invariant incremental consumers (streams, shared indexes) rely on.
 */
export function extendEntityIndex(index: EntityIndex, entities: string[]): void {
  const used = new Set(Object.keys(index.codeToName))

  for (const name of [...entities].sort()) {
    if (index.nameToCode[name] !== undefined) continue

    const base = toCode(name)
    let code = base
    let suffix = 1

    while (used.has(code)) {
      code = base.slice(0, 2) + String(suffix)
      suffix++
    }

    used.add(code)
    index.nameToCode[name] = code
    index.codeToName[code] = name
  }
}
