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

export function detectFlags(text: string): FlagName[] {
  const lower = text.toLowerCase()
  const result: FlagName[] = []

  for (const flag of FLAG_ORDER) {
    const keywords = FLAG_KEYWORDS[flag]
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        result.push(flag)
        break
      }
    }
  }

  return result
}
