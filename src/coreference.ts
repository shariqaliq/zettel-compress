import type { TextChunk } from './types.js'

// Compact given-name gazetteer for the gendered recency sieve. Names outside
// these lists simply never participate in he/she resolution — precision over
// recall, since a wrong link poisons the entity graph.
const FEMALE_NAMES = new Set([
  'alice', 'carol', 'emma', 'olivia', 'sophia', 'sofia', 'mia', 'amelia', 'isabella',
  'ava', 'charlotte', 'emily', 'sarah', 'sara', 'anna', 'maria', 'laura', 'julia',
  'lucy', 'grace', 'chloe', 'hannah', 'zoe', 'ella', 'lily', 'nora', 'ruby', 'alicia',
  'diana', 'elena', 'eva', 'irene', 'jane', 'karen', 'kate', 'katherine', 'linda',
  'lisa', 'megan', 'nancy', 'nina', 'rachel', 'rebecca', 'rita', 'rosa', 'susan',
  'tina', 'wendy', 'priya', 'aisha', 'fatima', 'mei', 'yuki', 'ingrid', 'astrid',
  'clara', 'elsa', 'frida', 'greta', 'margaret', 'beth', 'carmen', 'lucia', 'paula',
  'silvia', 'valentina', 'bianca', 'francesca', 'giulia', 'martina', 'katya',
  'natasha', 'olga', 'svetlana', 'tatiana', 'vera', 'zara', 'leila', 'noor',
  'samira', 'yasmin', 'helen', 'ruth', 'claire', 'audrey', 'naomi', 'iris',
])

const MALE_NAMES = new Set([
  'bob', 'robert', 'james', 'john', 'michael', 'david', 'william', 'richard',
  'joseph', 'thomas', 'charles', 'daniel', 'matthew', 'anthony', 'mark', 'steven',
  'paul', 'andrew', 'joshua', 'kenneth', 'kevin', 'brian', 'george', 'edward',
  'ronald', 'timothy', 'jason', 'jeffrey', 'ryan', 'jacob', 'gary', 'nicholas',
  'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott', 'brandon', 'benjamin',
  'samuel', 'frank', 'gregory', 'raymond', 'alexander', 'patrick', 'jack', 'dennis',
  'jerry', 'tyler', 'aaron', 'jose', 'adam', 'henry', 'nathan', 'douglas', 'zachary',
  'peter', 'kyle', 'walter', 'ethan', 'jeremy', 'harold', 'keith', 'christian',
  'roger', 'noah', 'gerald', 'carl', 'terry', 'sean', 'austin', 'arthur', 'lawrence',
  'jesse', 'dylan', 'bryan', 'joe', 'bruce', 'albert', 'gabriel', 'logan', 'juan',
  'carlos', 'luis', 'miguel', 'pedro', 'diego', 'marco', 'luca', 'giovanni', 'ahmed',
  'ali', 'omar', 'hassan', 'ravi', 'raj', 'kenji', 'sven', 'lars', 'erik', 'klaus',
  'hans', 'ivan', 'dmitri', 'sergei', 'boris', 'liam', 'oliver', 'harry', 'oscar',
  'leo', 'arjun', 'vikram', 'victor', 'hugo', 'felix', 'simon', 'martin', 'tom',
])

type Gender = 'female' | 'male' | 'unknown'

function genderOf(name: string): Gender {
  const first = (name.split(/[\s_-]/)[0] ?? '').toLowerCase()
  if (FEMALE_NAMES.has(first)) return 'female'
  if (MALE_NAMES.has(first)) return 'male'
  return 'unknown'
}

const FEMALE_PRONOUN = /\b(?:she|her|hers|herself)\b/i
const MALE_PRONOUN = /\b(?:he|him|his|himself)\b/i
const PLURAL_PRONOUN = /\b(?:they|them|their|theirs)\b/i

/**
 * Ordered high-precision coreference sieve over sequential chunks:
 * 1. Chat speaker labels already bind first-person turns to the speaker via
 *    entity detection — speakers feed the recency state here.
 * 2. he/she link to the most recently mentioned gender-matching entity when
 *    the chunk itself names no entity of that gender.
 * 3. they links to the two most recent entities when the chunk names none.
 * Each rule only adds names that were detected elsewhere in the document, so
 * the entity index is never extended — only chunk membership is.
 */
export function resolveCoreferences(
  chunks: TextChunk[],
  chunkEntities: string[][],
): string[][] {
  let lastFemale: string | null = null
  let lastMale: string | null = null
  const recent: string[] = [] // most recent entity last, deduplicated

  const noteEntity = (name: string): void => {
    const g = genderOf(name)
    if (g === 'female') lastFemale = name
    if (g === 'male') lastMale = name
    const idx = recent.indexOf(name)
    if (idx !== -1) recent.splice(idx, 1)
    recent.push(name)
  }

  return chunks.map((chunk, i) => {
    const detected = chunkEntities[i] ?? []
    const augmented = [...detected]
    const text = chunk.text

    const hasGender = (g: Gender) => detected.some((e) => genderOf(e) === g)

    if (FEMALE_PRONOUN.test(text) && !hasGender('female') && lastFemale !== null) {
      if (!augmented.includes(lastFemale)) augmented.push(lastFemale)
    }
    if (MALE_PRONOUN.test(text) && !hasGender('male') && lastMale !== null) {
      if (!augmented.includes(lastMale)) augmented.push(lastMale)
    }
    if (PLURAL_PRONOUN.test(text) && detected.length === 0) {
      for (const name of recent.slice(-2)) {
        if (!augmented.includes(name)) augmented.push(name)
      }
    }

    // recency state updates from named mentions in text order, so the most
    // recently *written* name wins, not the alphabetically last detected one
    const named = detected
      .map((name) => ({ name, pos: text.indexOf(name) }))
      .sort((a, b) => a.pos - b.pos)
    for (const { name } of named) noteEntity(name)

    return augmented.sort()
  })
}
