/**
 * YAKE-inspired keyword and keyphrase extraction (zero deps, deterministic).
 *
 * Based on: Campos et al. 2020, "YAKE! Keyword extraction from single
 * documents using multiple local features." Information Sciences, 509.
 *
 * Differences from the original:
 *   - No sentence split needed; we operate on a single chunk
 *   - Dispersion (DL) not computed (chunk is too short for meaningful spread)
 *   - Phrase deduplication: a unigram absorbed by a higher-scoring ngram is
 *     removed so it doesn't crowd out distinct concepts
 *   - Output: lowercase strings with spaces (e.g. "connection pool", "redis cache")
 *     Callers downstream (tunnel-builder, minhash) must tokenize on spaces when
 *     computing Jaccard/MinHash (breaking change from v0.3 which had only single tokens)
 */

import type { CompressOptions } from './types.js'

const BASE_STOP_WORDS = new Set([
  'a','an','the','and','but','or','nor','for','yet','so','in','on','at','to',
  'of','for','with','by','from','about','above','below','between','into','through',
  'during','before','after','against','among','around','along','across','behind',
  'beside','besides','beyond','despite','except','following','inside','like',
  'near','off','onto','out','outside','over','past','since','throughout','under',
  'until','up','upon','within','without','is','are','was','were','be','been',
  'being','have','has','had','do','does','did','will','would','could','should',
  'may','might','shall','must','can','need','dare','ought','used','able',
  'i','you','he','she','it','we','they','me','him','her','us','them',
  'my','your','his','its','our','their','this','that','these','those',
  'who','which','what','where','when','how','why','all','any','both','each',
  'few','more','most','other','some','such','no','not','only','same','than',
  'too','very','just','also','however','therefore','thus','hence','moreover',
  'furthermore','nevertheless','otherwise','indeed','instead','meanwhile',
  'already','always','often','usually','sometimes','never','here','there',
  'then','now','well','back','still','even','new','good','first','last',
  'own','right','great','little','small','large','big','high','long','next',
  'early','old','young','public','private','real','best','free','different',
  'important','possible','sure','true','false','yes','no','ok','okay',
])

const TECH_SUFFIXES = /(?:tion|ing|ment|ity|ness|ism|ist|ize|ise|ous|ful|less|able|ible)$/i

// ── text pre-cleaning ──────────────────────────────────────────────────────────

// Strip parenthesized timestamps "(1:56 pm on 8 May, 2023)" and chat speaker
// labels "Alice:" / "Bob:" before tokenizing — they create spurious high-
// frequency adjacency pairs ("2023 alice", "pm caroline") that YAKE would
// otherwise score as meaningful phrases.
const RE_PAREN_TS = /\([^)]{3,60}\)/g
const RE_SPEAKER_LABEL = /^[A-Z][a-zA-Z]{1,20}:\s*/gm

// Detect names that act as conversation turn-markers: a capitalized token
// that appears at least 3 times as a speaker label ("Alice:", "Bob:") in
// the text. These are added as dynamic stop words to prevent "thanks alice",
// "alice yeah" style noise phrases.
// Exported so compress() can run this once on the full document.
export function detectSpeakerNames(text: string): Set<string> {
  const names = new Set<string>()
  const re = /\b([A-Z][a-z]{2,15}):/g
  const counts: Record<string, number> = {}
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const name = m[1]!.toLowerCase()
    counts[name] = (counts[name] ?? 0) + 1
  }
  for (const [name, count] of Object.entries(counts)) {
    if (count >= 3) names.add(name)
  }
  return names
}

function precleanForTopics(text: string, speakerNames: Set<string>): string {
  let cleaned = text
    .replace(RE_PAREN_TS, ' ')
    .replace(RE_SPEAKER_LABEL, ' ')
  // Also blank out any remaining standalone occurrences of speaker names
  // so they don't anchor spurious bigrams ("thanks caroline")
  if (speakerNames.size > 0) {
    const namePattern = new RegExp(`\\b(${[...speakerNames].join('|')})\\b`, 'gi')
    cleaned = cleaned.replace(namePattern, ' ')
  }
  return cleaned
}

// ── token normalization ────────────────────────────────────────────────────────

function cleanToken(raw: string): string {
  return raw.replace(/^[^\w-]+|[^\w-]+$/g, '').replace(/['".,!?;:()[\]{}]/g, '')
}

function isStopWord(lower: string, stopWords: Set<string>): boolean {
  return stopWords.has(lower) || lower.length < 3
}

// ── per-token YAKE features ────────────────────────────────────────────────────

interface TokenStat {
  raw: string          // best-cased form seen
  lower: string
  freq: number
  positions: number[]  // 0-indexed position in token stream
  isUpper: boolean     // ALL-CAPS
  isCamel: boolean     // CamelCase
  isHyphen: boolean    // hyphen-ated
  isTechSuffix: boolean
}

function buildTokenStats(tokens: string[], stopWords: Set<string>): Map<string, TokenStat> {
  const stats = new Map<string, TokenStat>()
  for (let pos = 0; pos < tokens.length; pos++) {
    const raw = cleanToken(tokens[pos]!)
    if (raw.length < 2) continue
    const lower = raw.toLowerCase()
    if (isStopWord(lower, stopWords)) continue

    const existing = stats.get(lower)
    if (existing) {
      existing.freq++
      existing.positions.push(pos)
      // prefer the cased form that first appeared
    } else {
      stats.set(lower, {
        raw,
        lower,
        freq: 1,
        positions: [pos],
        isUpper: /^[A-Z]{2,}$/.test(raw),
        isCamel: /^[A-Z][a-z]+(?:[A-Z][a-z]*)+$/.test(raw),
        isHyphen: /-/.test(raw) && raw.split('-').every((p) => p.length > 1),
        isTechSuffix: raw.length > 6 && TECH_SUFFIXES.test(raw),
      })
    }
  }
  return stats
}

// YAKE score for a unigram: lower = better keyword
// S(w) = freq(w) * stdDev(positions) / (1 + boost)
// We invert and re-scale to [0,∞) where higher = better (standard for ranking)
function unigram_score(stat: TokenStat, n: number): number {
  // TF normalized by document length
  const tf = stat.freq / Math.max(n, 1)

  // Spread: stddev of positions normalized by doc length
  // Low spread (term appears only once or in a cluster) → lower quality
  let spread = 0
  if (stat.positions.length > 1) {
    const mean = stat.positions.reduce((a, b) => a + b, 0) / stat.positions.length
    const variance =
      stat.positions.reduce((a, p) => a + (p - mean) ** 2, 0) / stat.positions.length
    spread = Math.sqrt(variance) / Math.max(n, 1)
  }

  // Base score: frequency weighted by spread (YAKE's TC * TF intuition)
  let score = tf * (1 + spread)

  // Surface feature boosts (same as old extractor, so rankings are compatible)
  if (stat.isUpper) score *= 2.0
  else if (stat.isCamel) score *= 2.5
  else if (stat.isHyphen) score *= 1.8
  else if (stat.isTechSuffix) score *= 1.3

  return score
}

// ── bigram / trigram extraction ────────────────────────────────────────────────

const MAX_PHRASE_TOKENS = 3  // max ngram size

interface Phrase {
  tokens: string[]    // lowercase component tokens
  display: string     // lowercase display string ("connection pool")
  score: number
  freq: number
}

function extractPhrases(
  tokenStream: string[],
  stats: Map<string, TokenStat>,
  stopWords: Set<string>,
  n: number,
): Phrase[] {
  const phraseMap = new Map<string, Phrase>()

  for (let i = 0; i < tokenStream.length; i++) {
    for (let len = 2; len <= MAX_PHRASE_TOKENS; len++) {
      if (i + len > tokenStream.length) break

      const slice = tokenStream.slice(i, i + len).map(cleanToken)

      // A phrase must not start or end with a stop word
      const firstLower = slice[0]!.toLowerCase()
      const lastLower = slice[len - 1]!.toLowerCase()
      if (isStopWord(firstLower, stopWords) || isStopWord(lastLower, stopWords)) continue

      // Internal tokens may be stop words (e.g. "state of the art" → ok)
      // but every non-stop token must appear in stats (i.e. has content)
      const contentTokens = slice.filter((t) => !isStopWord(t.toLowerCase(), stopWords))
      if (contentTokens.length < 2) continue
      // Reject phrases where all content tokens are identical ("real-time real-time")
      if (new Set(contentTokens.map((t) => t.toLowerCase())).size < 2) continue
      // Reject if any content token is too short to carry meaning
      if (contentTokens.some((t) => t.replace(/-/g, '').length < 4)) continue
      // For trigrams: the middle token must also be a non-stop content word
      // to avoid "pool was hitting" style spans
      if (len === 3 && isStopWord((slice[1] ?? '').toLowerCase(), stopWords)) continue

      const display = slice.map((t) => t.toLowerCase()).join(' ')

      const existing = phraseMap.get(display)
      if (existing) {
        existing.freq++
        // YAKE phrase score = product of component unigram scores / (freq^2 + 1)
        // Re-score with updated freq
        const compScore = contentTokens.reduce((acc, t) => {
          const stat = stats.get(t.toLowerCase())
          return acc * (stat ? unigram_score(stat, n) : 0.01)
        }, 1)
        existing.score = compScore / (existing.freq ** 2 + 1)
      } else {
        const compScore = contentTokens.reduce((acc, t) => {
          const stat = stats.get(t.toLowerCase())
          return acc * (stat ? unigram_score(stat, n) : 0.01)
        }, 1)
        phraseMap.set(display, {
          tokens: contentTokens.map((t) => t.toLowerCase()),
          display,
          score: compScore,
          freq: 1,
        })
      }
    }
  }

  return [...phraseMap.values()]
}

// ── deduplication: absorb unigrams covered by higher-scoring phrases ──────────

function dedupeWithPhrases(
  unigrams: Array<{ display: string; score: number }>,
  phrases: Phrase[],
): Array<{ display: string; score: number }> {
  // Collect all tokens that appear in a retained phrase
  const absorbedByPhrase = new Set<string>()
  for (const p of phrases) {
    for (const t of p.tokens) absorbedByPhrase.add(t)
  }

  return unigrams.filter((u) => {
    // Keep if not absorbed, or if it scores higher than all phrases containing it
    if (!absorbedByPhrase.has(u.display)) return true
    const covering = phrases.filter((p) => p.tokens.includes(u.display))
    return covering.every((p) => u.score > p.score * 1.5)
  })
}

// ── public API ─────────────────────────────────────────────────────────────────

/**
 * Extract up to `maxTopics` keyphrases from `text` using YAKE-style scoring.
 *
 * Returns lowercase strings. Multi-word phrases use spaces as separators
 * (e.g. "connection pool", "rate limiting"). Callers that compute set Jaccard
 * or MinHash must tokenize on spaces before comparing.
 */
export function extractTopics(
  text: string,
  minFreq = 1,
  extraStopWords?: string[],
  maxTopics = 8,
  speakerNames?: Set<string>,
): string[] {
  const stopWords = extraStopWords
    ? new Set([...BASE_STOP_WORDS, ...extraStopWords.map((w) => w.toLowerCase())])
    : BASE_STOP_WORDS

  // Use pre-computed speaker names from the full doc when available;
  // fall back to per-chunk detection (less accurate but self-contained)
  const names = speakerNames ?? detectSpeakerNames(text)
  const tokenStream = precleanForTopics(text, names).split(/\s+/)
  const n = tokenStream.length
  if (n === 0) return []

  const stats = buildTokenStats(tokenStream, stopWords)
  if (stats.size === 0) return []

  // Unigram candidates
  const unigrams: Array<{ display: string; score: number }> = []
  for (const [lower, stat] of stats) {
    if (stat.freq < minFreq) continue
    unigrams.push({ display: lower, score: unigram_score(stat, n) })
  }

  // Phrase candidates (freq ≥ 1 always — phrases are inherently rare)
  const phrases = extractPhrases(tokenStream, stats, stopWords, n)
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    // Take at most half the budget as phrases so unigrams aren't crowded out
    .slice(0, Math.ceil(maxTopics / 2))

  // Remove unigrams fully absorbed by a phrase
  const filteredUnigrams = dedupeWithPhrases(unigrams, phrases)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTopics - phrases.length)

  // Merge and sort by score descending, then alpha for determinism on ties
  const all = [
    ...phrases.map((p) => ({ display: p.display, score: p.score })),
    ...filteredUnigrams,
  ].sort((a, b) => b.score - a.score || a.display.localeCompare(b.display))

  return all.slice(0, maxTopics).map((x) => x.display)
}
