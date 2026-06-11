import type { EmotionName, FlagName } from './types.js'

const EMOTION_KEYWORDS: Record<EmotionName, string[]> = {
  conviction:    ['decided', 'committed', 'certain', 'determined', 'resolved', 'firm', 'unwavering', 'absolutely'],
  grief:         ['lost', 'miss', 'sad', 'mourning', 'grief', 'heartbroken', 'devastated', 'loss'],
  joy:           ['happy', 'excited', 'wonderful', 'delighted', 'elated', 'thrilled', 'joyful', 'glad'],
  fear:          ['afraid', 'worried', 'scared', 'terrified', 'dread', 'panic', 'fearful', 'terror'],
  hope:          ['hope', 'optimistic', 'looking forward', 'aspire', 'wish', 'bright', 'promise', 'hopeful'],
  trust:         ['trust', 'rely', 'depend', 'confident', 'faith', 'assured', 'secure', 'reliable'],
  wonder:        ['amazing', 'incredible', 'fascinating', 'curious', 'astonishing', 'remarkable', 'awe-inspiring'],
  rage:          ['angry', 'furious', 'hate', 'outraged', 'enraged', 'livid', 'infuriated', 'seething'],
  exhaustion:    ['tired', 'burnt out', 'overwhelmed', 'drained', 'exhausted', 'depleted', 'weary', 'burnout'],
  shame:         ['ashamed', 'embarrassed', 'humiliated', 'mortified', 'disgraced', 'shameful'],
  pride:         ['proud', 'accomplished', 'achieved', 'earned', 'succeeded', 'triumphant', 'excellence'],
  nostalgia:     ['remember', 'used to', 'back then', 'childhood', 'memories', 'once upon', 'years ago', 'miss the'],
  anxiety:       ['anxious', 'nervous', 'uneasy', 'restless', 'apprehensive', 'on edge', 'tense', 'stress'],
  relief:        ['relieved', 'finally', 'at last', 'thankfully', 'unburdened', 'resolved', 'cleared'],
  anticipation:  ['soon', 'upcoming', 'looking forward', 'preparing', 'planning', 'next', 'expecting', 'anticipate'],
  frustration:   ['frustrated', 'annoyed', 'irritated', 'stuck', 'blocked', "can't", 'impossible', 'pointless'],
  gratitude:     ['grateful', 'thankful', 'appreciate', 'thanks', 'blessed', 'indebted', 'gratitude'],
  loneliness:    ['alone', 'lonely', 'isolated', 'no one', 'by myself', 'disconnected', 'abandoned', 'solitude'],
  inspiration:   ['inspired', 'motivated', 'energized', 'sparked', 'ignited', 'driven', 'passionate', 'creative'],
  confusion:     ['confused', 'unclear', 'unsure', 'uncertain', 'puzzled', 'baffled', "don't understand", 'lost'],
  clarity:       ['clear', 'understood', 'realized', 'now i see', 'makes sense', 'obvious', 'enlightened', 'clarity'],
  guilt:         ['guilty', 'regret', 'should have', "shouldn't have", 'my fault', 'blame myself', 'remorse'],
  awe:           ['awe', 'breathtaking', 'profound', 'transcendent', 'majestic', 'overwhelming beauty'],
  regret:        ['wish i had', 'if only', 'missed opportunity', 'looking back', "could've", 'should have done'],
  determination: ['will not stop', 'never give up', 'keep going', 'persist', 'push through', 'no matter what'],
  vulnerability: ['vulnerable', 'exposed', 'raw', 'open up', 'honest about', 'sharing', 'admit that'],
  acceptance:    ['accepted', 'at peace', 'moved on', 'let go', 'embrace', 'okay with', 'come to terms'],
  resistance:    ['resist', 'refuse', 'against', 'oppose', 'reject', 'push back', 'disagree', "won't"],
  love:          ['love', 'adore', 'cherish', 'devoted', 'affection', 'warmth', 'care deeply', 'deeply care'],
  loss:          ['gone', 'passed away', 'ended', 'over now', 'no more', 'finished', 'goodbye', 'farewell'],
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

export function computeWeight(emotions: EmotionName[], flags: FlagName[], text: string): number {
  const flagScore = Math.min(flags.length * 0.3, 0.9)
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
