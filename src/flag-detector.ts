import type { FlagName } from './types.js'

const FLAG_KEYWORDS: Record<FlagName, string[]> = {
  DECISION:  ['decided', 'chose', 'committed', 'resolved', 'agreed', 'concluded', 'going to', 'will do', 'must do'],
  ORIGIN:    ['founded', 'created', 'started', 'began', 'originated', 'established', 'first time', 'inception', 'birth of'],
  CORE:      ['fundamental', 'essential', 'always', 'core', 'central', 'key principle', 'foundation', 'basis', 'bedrock'],
  PIVOT:     ['turning point', 'realized', 'breakthrough', 'changed everything', 'shift', 'transformed', 'pivotal', 'game changer'],
  GENESIS:   ['led to', 'resulted in', 'because of this', 'caused', 'triggered', 'sparked', 'gave rise to', 'origin of'],
  TECHNICAL: ['architecture', 'implement', 'deploy', 'config', 'database', 'api', 'function', 'class', 'module', 'infrastructure', 'stack', 'endpoint', 'schema'],
}

const FLAG_ORDER: FlagName[] = ['DECISION', 'ORIGIN', 'CORE', 'PIVOT', 'GENESIS', 'TECHNICAL']

const NEGATION_WORDS = new Set([
  'not', "n't", 'never', 'no', 'neither', 'hardly', 'barely',
  'without', 'unable', 'failed', 'refused', 'denied',
])

function isNegated(lower: string, kwIndex: number): boolean {
  const window = lower.slice(Math.max(0, kwIndex - 40), kwIndex)
  const tail = window.trim().split(/\s+/).slice(-4)
  return tail.some((w) => NEGATION_WORDS.has(w.replace(/[^a-z']/g, '')))
}

export function detectFlags(text: string): FlagName[] {
  const lower = text.toLowerCase()
  const result: FlagName[] = []

  for (const flag of FLAG_ORDER) {
    const keywords = FLAG_KEYWORDS[flag]
    for (const kw of keywords) {
      const idx = lower.indexOf(kw)
      if (idx !== -1 && !isNegated(lower, idx)) {
        result.push(flag)
        break
      }
    }
  }

  return result
}
