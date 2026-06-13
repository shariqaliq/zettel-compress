import type { FlagName } from './types.js'

const FLAG_KEYWORDS: Record<FlagName, string[]> = {
  // Removed: 'resolved' (bug/DNS resolved), bare 'agreed' (social filler in every chat turn)
  // Kept 'agreed to' (multi-word — requires an explicit object, much less noisy)
  DECISION:  ['decided', 'chose', 'committed', 'concluded', 'agreed to', 'going to', 'will do', 'must do', 'we will', 'final decision'],
  // Removed: 'created' (created a function/PR), 'started' (server started, started a loop),
  //          'began' (too generic), 'established' (established a connection)
  ORIGIN:    ['founded', 'originated', 'first time ever', 'inception', 'birth of', 'how it began', 'where it started'],
  // Removed: 'always' (fires on every habitual statement), 'core' (core dump, core i7),
  //          'central' (central node), 'basis' (on the basis of)
  CORE:      ['fundamental', 'essential', 'key principle', 'foundation of', 'bedrock', 'non-negotiable', 'must always'],
  // Removed: 'shift' (bit shift, time shift), 'realized' (too generic — "I realized the bug")
  PIVOT:     ['turning point', 'breakthrough', 'changed everything', 'transformed', 'pivotal', 'game changer', 'everything changed'],
  // Removed: 'caused' ("this caused a bug" — routine), 'triggered' (event triggered),
  //          'sparked' (overlaps inspiration emotion)
  GENESIS:   ['led to', 'resulted in', 'because of this', 'gave rise to', 'origin of', 'which caused', 'set in motion'],
  // Removed: 'function' (mathematical function, "function of"), 'class' (world class, class of problems),
  //          'api' (fires in almost every tech chunk — too broad)
  TECHNICAL: ['architecture', 'implement', 'deploy', 'config', 'database', 'module', 'infrastructure', 'stack', 'endpoint', 'schema'],
}

const FLAG_ORDER: FlagName[] = ['DECISION', 'ORIGIN', 'CORE', 'PIVOT', 'GENESIS', 'TECHNICAL']

const NEGATION_WORDS = new Set([
  'not', "n't", 'never', 'no', 'neither', 'hardly', 'barely', 'scarcely',
  'without', 'unable', 'failed', 'refused', 'denied',
])

const IMPLICIT_NEGATORS = ['failed to', 'unable to', 'refused to', 'avoided', 'lack of', 'free from']

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Word-boundary matching — substring matching false-fires ('api' in "rapid",
// 'class' in "classic"), so keywords are compiled once into \b-anchored patterns
const FLAG_PATTERNS = Object.fromEntries(
  (Object.entries(FLAG_KEYWORDS) as [FlagName, string[]][]).map(([flag, keywords]) => [
    flag,
    new RegExp(`\\b(?:${keywords.map(escapeRegExp).join('|')})\\b`, 'g'),
  ]),
) as Record<FlagName, RegExp>

function isNegated(lower: string, kwIndex: number): boolean {
  const window = lower.slice(Math.max(0, kwIndex - 50), kwIndex)
  const tail = window.trim().split(/\s+/).slice(-6)
  if (tail.some((w) => NEGATION_WORDS.has(w.replace(/[^a-z']/g, '')))) return true
  return IMPLICIT_NEGATORS.some((phrase) => {
    const phraseIdx = lower.lastIndexOf(phrase, kwIndex)
    return phraseIdx !== -1 && kwIndex - phraseIdx <= 50
  })
}

export function detectFlags(text: string): FlagName[] {
  const lower = text.toLowerCase()
  const result: FlagName[] = []

  for (const flag of FLAG_ORDER) {
    const pattern = FLAG_PATTERNS[flag]
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(lower)) !== null) {
      if (!isNegated(lower, match.index)) {
        result.push(flag)
        break
      }
    }
  }

  return result
}
