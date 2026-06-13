import type { EmotionName, FlagName } from './types.js'

const EMOTION_KEYWORDS: Record<EmotionName, string[]> = {
  // Removed: 'resolved' (fires on bug/DNS resolved), 'absolutely' (discourse filler)
  conviction:    ['decided', 'committed', 'certain', 'determined', 'firm', 'unwavering'],
  // Removed: 'miss' (miss the point, miss a step — too ambiguous in tech)
  grief:         ['lost', 'sad', 'mourning', 'grief', 'heartbroken', 'devastated', 'loss of'],
  joy:           ['happy', 'excited', 'wonderful', 'delighted', 'elated', 'thrilled', 'joyful', 'glad'],
  fear:          ['afraid', 'worried', 'scared', 'terrified', 'dread', 'panic', 'fearful', 'terror'],
  hope:          ['hope', 'optimistic', 'looking forward to', 'aspire', 'hopeful', 'bright future'],
  trust:         ['trust', 'rely on', 'depend on', 'confident in', 'faith in', 'assured', 'reliable'],
  wonder:        ['incredible', 'fascinating', 'curious', 'astonishing', 'remarkable', 'awe-inspiring'],
  rage:          ['angry', 'furious', 'hate', 'outraged', 'enraged', 'livid', 'infuriated', 'seething'],
  exhaustion:    ['burnt out', 'overwhelmed', 'drained', 'exhausted', 'depleted', 'weary', 'burnout'],
  shame:         ['ashamed', 'embarrassed', 'humiliated', 'mortified', 'disgraced', 'shameful'],
  pride:         ['proud', 'accomplished', 'achieved', 'succeeded', 'triumphant', 'excellence'],
  nostalgia:     ['used to', 'back then', 'childhood', 'memories', 'once upon', 'years ago', 'miss the old'],
  // Removed: 'stress' (stress test, stress the point), 'tense' (tense situation ok but also grammar)
  anxiety:       ['anxious', 'nervous', 'uneasy', 'restless', 'apprehensive', 'on edge', 'stressed out'],
  // Removed: 'finally' (neutral temporal), 'resolved' (bug resolved), 'cleared' (queue cleared)
  relief:        ['relieved', 'at last', 'thankfully', 'unburdened', 'weight off'],
  // Removed: 'next' (fires everywhere), 'planning' (every project), 'soon' (too generic)
  anticipation:  ['upcoming', 'looking forward to', 'preparing for', 'expecting', 'anticipate', 'cant wait'],
  // Removed: "can't" (too generic — "can't reproduce", "can't merge")
  frustration:   ['frustrated', 'annoyed', 'irritated', 'stuck on', 'blocked by', 'impossible to', 'pointless'],
  // Removed: 'thanks' (social filler in every chat turn), 'blessed' (too broad)
  gratitude:     ['grateful', 'thankful', 'appreciate', 'indebted', 'gratitude'],
  // Removed: 'alone' ("alone this handles"), 'isolated' (isolated test, isolated env)
  loneliness:    ['lonely', 'no one', 'by myself', 'disconnected', 'abandoned', 'solitude'],
  inspiration:   ['inspired', 'motivated', 'energized', 'ignited', 'driven', 'passionate', 'creative'],
  // Removed: 'lost' (ambiguous), 'unclear' (unclear requirement — not emotional)
  confusion:     ['confused', 'unsure', 'uncertain', 'puzzled', 'baffled', "don't understand"],
  // Removed: 'clear' ("clear the cache"), 'obvious' (dismissive not emotional), 'realized' (goes to PIVOT flag)
  clarity:       ['now i see', 'makes sense now', 'enlightened', 'suddenly understood', 'clicked for me'],
  guilt:         ['guilty', 'regret', 'should have', "shouldn't have", 'my fault', 'blame myself', 'remorse'],
  awe:           ['awe', 'breathtaking', 'profound', 'transcendent', 'majestic', 'overwhelming beauty'],
  regret:        ['wish i had', 'if only', 'missed opportunity', 'looking back', "could've done", 'should have done'],
  determination: ['will not stop', 'never give up', 'keep going', 'persist', 'push through', 'no matter what'],
  // Removed: 'sharing' ("we're sharing the config"), 'exposed' (exposed endpoint)
  vulnerability: ['vulnerable', 'raw emotion', 'open up', 'honest about', 'admit that', 'being real'],
  acceptance:    ['at peace', 'moved on', 'let go', 'embrace', 'okay with', 'come to terms'],
  resistance:    ['resist', 'refuse to', 'oppose', 'push back', 'disagree', "won't do"],
  love:          ['love', 'adore', 'cherish', 'devoted', 'affection', 'warmth', 'care deeply', 'deeply care'],
  // Removed: 'finished' ("I finished the implementation"), 'ended' (session ended), 'gone' (too generic)
  loss:          ['passed away', 'over now', 'no more', 'goodbye forever', 'farewell', 'we lost them'],
}

const DECISION_WORDS = ['decided', 'chose', 'committed', 'resolved', 'must', 'will', 'determined', 'going to']

// Negation window: if any of these appear within 6 words before a keyword, suppress the match
const NEGATION_WORDS = new Set([
  'not', "n't", 'never', 'no', 'neither', 'hardly', 'barely', 'scarcely',
  'without', 'unable', 'failed', 'refused', 'denied',
])

// Implicit multi-word negators (arXiv 2025 negation taxonomy)
const IMPLICIT_NEGATORS = ['failed to', 'unable to', 'refused to', 'avoided', 'lack of', 'free from']

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Word-boundary matching — substring matching false-fires ('miss' in "mission",
// 'hate' in "chateau"), so keywords are compiled once into \b-anchored patterns
const EMOTION_PATTERNS = Object.fromEntries(
  (Object.entries(EMOTION_KEYWORDS) as [EmotionName, string[]][]).map(([emotion, keywords]) => [
    emotion,
    new RegExp(`\\b(?:${keywords.map(escapeRegExp).join('|')})\\b`, 'g'),
  ]),
) as Record<EmotionName, RegExp>

function isNegated(lower: string, kwIndex: number): boolean {
  const window = lower.slice(Math.max(0, kwIndex - 50), kwIndex)
  const windowWords = window.trim().split(/\s+/)
  const tail = windowWords.slice(-6)
  if (tail.some((w) => NEGATION_WORDS.has(w.replace(/[^a-z']/g, '')))) return true
  return IMPLICIT_NEGATORS.some((phrase) => {
    const phraseIdx = lower.lastIndexOf(phrase, kwIndex)
    return phraseIdx !== -1 && kwIndex - phraseIdx <= 50
  })
}

export function detectEmotions(text: string): EmotionName[] {
  const lower = text.toLowerCase()
  const result: EmotionName[] = []

  for (const [emotion, pattern] of Object.entries(EMOTION_PATTERNS) as [EmotionName, RegExp][]) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(lower)) !== null) {
      if (!isNegated(lower, match.index)) {
        result.push(emotion)
        break
      }
    }
  }

  return result
}

// Signal flags that indicate genuine importance — TECHNICAL is metadata only
// and fires too broadly (architecture, deploy, config in almost every tech chunk)
// so it is excluded from weight to preserve score distribution spread.
const WEIGHT_FLAGS = new Set<FlagName>(['DECISION', 'ORIGIN', 'CORE', 'PIVOT', 'GENESIS'])

export function computeWeight(emotions: EmotionName[], flags: FlagName[], text: string): number {
  const signalFlags = flags.filter((f) => WEIGHT_FLAGS.has(f))
  const flagScore = Math.min(signalFlags.length * 0.35, 0.9)
  const emotionScore = Math.min(emotions.length * 0.1, 0.4)

  const words = text.toLowerCase().split(/\s+/)
  const decisionCount = words.filter((w) =>
    DECISION_WORDS.some((d) => w.replace(/[^a-z']/g, '') === d),
  ).length
  const decisionDensity = words.length > 0 ? decisionCount / words.length : 0

  const raw = flagScore + emotionScore + decisionDensity * 0.5
  const clamped = Math.min(raw, 1.0)
  return Math.round(clamped * 100) / 100
}
