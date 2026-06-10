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
])

export function detectEntities(text: string, minFreq = 2): string[] {
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
  const nameToCode: Record<string, string> = {}
  const codeToName: Record<string, string> = {}
  const used = new Set<string>()

  for (const name of [...entities].sort()) {
    let base = toCode(name)
    let code = base
    let suffix = 1

    while (used.has(code)) {
      code = base.slice(0, 2) + String(suffix)
      suffix++
    }

    used.add(code)
    nameToCode[name] = code
    codeToName[code] = name
  }

  return { nameToCode, codeToName }
}
