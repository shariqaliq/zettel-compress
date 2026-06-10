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

export function extractTopics(
  text: string,
  minFreq = 1,
  extraStopWords?: string[],
): string[] {
  const stopWords = extraStopWords
    ? new Set([...BASE_STOP_WORDS, ...extraStopWords.map((w) => w.toLowerCase())])
    : BASE_STOP_WORDS

  const tokens = text.split(/\s+/)
  const scores: Record<string, number> = {}

  for (const raw of tokens) {
    const stripped = raw.replace(/^[^\w-]+|[^\w-]+$/g, '').replace(/['".,!?;:()[\]{}]/g, '')
    if (stripped.length < 3) continue

    const lower = stripped.toLowerCase()
    if (stopWords.has(lower)) continue

    let boost = 1.0

    // All-caps (API, LLM, JWT, etc.)
    if (/^[A-Z]{2,}$/.test(stripped)) boost *= 2.0
    // CamelCase (LangChain, OpenAI, ChromaDB)
    else if (/^[A-Z][a-z]+(?:[A-Z][a-z]*)+$/.test(stripped)) boost *= 2.5
    // Hyphenated (real-time, end-to-end)
    else if (/-/.test(stripped) && stripped.split('-').every((p) => p.length > 1)) boost *= 1.8
    // Technical suffix (architecture, implementation)
    else if (stripped.length > 6 && TECH_SUFFIXES.test(stripped)) boost *= 1.3

    scores[lower] = (scores[lower] ?? 0) + boost
  }

  return Object.entries(scores)
    .filter(([, score]) => score >= minFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word)
}
