const DECISION_WORDS = new Set([
  'decided', 'chose', 'choose', 'will', 'must', 'committed', 'resolved',
  'determined', 'agreed', 'concluded', 'going', 'plan', 'intend', 'shall',
])

// Split on sentence-ending punctuation but not abbreviations (1-2 char words before '.')
function splitSentences(text: string): string[] {
  const sentences: string[] = []
  // Replace common abbreviations with a placeholder to avoid false splits
  const cleaned = text
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\./gi, (m) => m.replace('.', '\x00'))
    .replace(/\b([A-Z]{1,2})\./g, (m) => m.replace('.', '\x00'))

  const parts = cleaned.split(/(?<=[.!?])\s+(?=[A-Z"'])/)

  for (const part of parts) {
    const restored = part.replace(/\x00/g, '.').trim()
    if (restored.length > 0) sentences.push(restored)
  }

  return sentences.length > 0 ? sentences : [text.trim()]
}

export function selectKeySentence(text: string): string {
  const trimmed = text.trim()
  const words = trimmed.split(/\s+/)

  if (words.length < 5) return trimmed.slice(0, 120)

  const sentences = splitSentences(trimmed)
  if (sentences.length === 0) return trimmed.slice(0, 120)

  let best = sentences[0] ?? trimmed
  let bestScore = -Infinity

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i] ?? ''
    const sWords = s.split(/\s+/)
    const wordCount = sWords.length

    const decisionCount = sWords.filter((w) =>
      DECISION_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')),
    ).length
    const decisionDensity = wordCount > 0 ? decisionCount / wordCount : 0

    let lengthBonus = 0
    if (wordCount >= 10 && wordCount <= 25) lengthBonus = 0.2
    else if (wordCount < 5) lengthBonus = -0.3
    else if (wordCount > 40) lengthBonus = -0.1

    const uniqueRatio =
      wordCount > 0 ? new Set(sWords.map((w) => w.toLowerCase())).size / wordCount : 0

    const positionBonus = i === 0 || i === sentences.length - 1 ? 0.1 : 0

    // Absolute decision count matters more than density for short sentences
    const decisionAbsolute = decisionCount * 0.4
    const score =
      decisionDensity * 3.0 + decisionAbsolute + lengthBonus + uniqueRatio * 0.3 + positionBonus

    if (score > bestScore) {
      bestScore = score
      best = s
    }
  }

  return best.trim()
}
