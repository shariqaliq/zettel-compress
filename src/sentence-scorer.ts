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

  let parts = cleaned.split(/(?<=[.!?])\s+(?=[A-Z"'])/)

  // Fallbacks for informal text: the primary split requires the next sentence
  // to start with a capital letter, which chat logs and lowercase prose never
  // satisfy — without these the entire chunk becomes one "sentence"
  if (parts.length <= 1) {
    const byLine = cleaned.split(/\n+/).map((s) => s.trim()).filter((s) => s.length > 10)
    if (byLine.length > 1) parts = byLine
  }
  if (parts.length <= 1) {
    const byPunct = cleaned.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 10)
    if (byPunct.length > 1) parts = byPunct
  }

  for (const part of parts) {
    const restored = part.replace(/\x00/g, '.').trim()
    if (restored.length > 0) sentences.push(restored)
  }

  return sentences.length > 0 ? sentences : [text.trim()]
}

// TextRank: Jaccard word-overlap similarity, damping d=0.85, 10 iterations (PMC 2024)
function textRankScores(sentences: string[]): number[] {
  const n = sentences.length
  if (n === 1) return [1]

  const wordSets = sentences.map((s) => new Set(s.toLowerCase().split(/\s+/)))
  const scores = new Array<number>(n).fill(1 / n)

  const similarities: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const si = wordSets[i]!
      const sj = wordSets[j]!
      let inter = 0
      for (const w of si) if (sj.has(w)) inter++
      const union = si.size + sj.size - inter
      similarities[i]![j] = union > 0 ? inter / union : 0
    }
  }

  for (let iter = 0; iter < 10; iter++) {
    const next = new Array<number>(n).fill(0)
    for (let i = 0; i < n; i++) {
      let incoming = 0
      for (let j = 0; j < n; j++) {
        if (i === j) continue
        const rowSum = similarities[j]!.reduce((a, v) => a + v, 0)
        incoming += rowSum > 0 ? (similarities[j]![i]! / rowSum) * scores[j]! : 0
      }
      next[i] = (1 - 0.85) / n + 0.85 * incoming
    }
    for (let i = 0; i < n; i++) scores[i] = next[i]!
  }

  const max = Math.max(...scores)
  return max > 0 ? scores.map((s) => s / max) : scores
}

export function selectKeySentence(text: string): string {
  const trimmed = text.trim()
  const words = trimmed.split(/\s+/)

  if (words.length < 5) return trimmed.slice(0, 120)

  const sentences = splitSentences(trimmed)
  if (sentences.length === 0) return trimmed.slice(0, 120)

  const centrality = textRankScores(sentences)

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
    const decisionAbsolute = decisionCount * 0.4

    const decisionScore = decisionDensity * 3.0 + decisionAbsolute + lengthBonus + uniqueRatio * 0.3 + positionBonus
    // Blend 50/50: TextRank centrality + decision score
    const score = 0.5 * (centrality[i] ?? 0) + 0.5 * decisionScore

    if (score > bestScore) {
      bestScore = score
      best = s
    }
  }

  return best.trim()
}
