# Integration recipes

Working patterns for real projects. Every snippet uses only the public API.

## 1. The canonical chatbot memory loop

Keep recent messages verbatim; compress everything older; answer questions
from recalled passages. This is the highest-quality pattern per token:

```ts
import { compress, recallContext } from 'zettel-compress'

const RECENT = 10 // keep the tail verbatim

async function reply(allMessages: { role: string; content: string }[], userMessage: string) {
  const recent = allMessages.slice(-RECENT)
  const older = allMessages.slice(0, -RECENT)

  let memoryBlock = ''
  if (older.length > 0) {
    const memory = compress(older.map((m) => `${m.role}: ${m.content}`).join('\n\n'))
    memoryBlock = recallContext(memory, userMessage, { topK: 10, maxTokens: 1500 })
  }

  return llm.chat([
    { role: 'system', content: `Relevant earlier conversation:\n${memoryBlock}` },
    ...recent,
    { role: 'user', content: userMessage },
  ])
}
```

Why recall against the *user's message*: the question itself is the best
retrieval query you'll ever get. For multi-turn topics, append the last
assistant turn to the query.

Re-compressing `older` on every call is usually fine (~2ms per 100 messages);
cache the `CompressResult` keyed on `older.length` if you want.

## 2. Vercel AI SDK

```ts
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { compress, recallContext } from 'zettel-compress'

const memory = compress(historyText)

const result = await streamText({
  model: openai('gpt-4o-mini'),
  messages: [
    {
      role: 'system',
      content: `Use this earlier context when relevant:\n${recallContext(
        memory,
        latestUserMessage,
        { maxTokens: 1500 },
      )}`,
    },
    ...recentMessages,
  ],
})
```

## 3. Cloudflare Workers + KV (zero infrastructure persistence)

Store two values per session: the raw log (payload) and the AAAK string
(index). Recall needs both — AAAK deliberately never embeds the source text.

```ts
import { compress, encode, decode, recallContext } from 'zettel-compress'

export default {
  async fetch(req: Request, env: Env) {
    const { sessionId, message, question } = await req.json()

    if (question) {
      const [aaak, log] = await Promise.all([
        env.KV.get(`idx:${sessionId}`),
        env.KV.get(`log:${sessionId}`),
      ])
      if (!aaak || !log) return Response.json({ context: '' })
      const context = recallContext(decode(aaak), question, {
        source: log.replace(/\r\n/g, '\n'), // offsets index the normalized text
        maxTokens: 1500,
      })
      return Response.json({ context })
    }

    const log = ((await env.KV.get(`log:${sessionId}`)) ?? '') + '\n\n' + message
    await env.KV.put(`log:${sessionId}`, log)
    await env.KV.put(`idx:${sessionId}`, encode(compress(log)))
    return new Response('ok')
  },
}
```

Total worker bundle cost: ~18 kB gzipped. No bindings beyond KV.

## 4. Browser / local-first (text never leaves the device)

The whole engine runs client-side ([live demo](https://shariqaliq.github.io/zettel-compress/)).
Persist to IndexedDB or localStorage:

```ts
import { compress, encode, decode, recallContext } from 'zettel-compress'

function save(noteText: string) {
  localStorage.setItem('notes:log', noteText)
  localStorage.setItem('notes:idx', encode(compress(noteText)))
}

function search(question: string): string {
  const idx = localStorage.getItem('notes:idx')
  const log = localStorage.getItem('notes:log')
  if (!idx || !log) return ''
  return recallContext(decode(idx), question, { source: log, maxTokens: 1000 })
}
```

This is the configuration nothing else offers: semantic-ish memory search in
a privacy-bound app with zero network access.

## 5. Long-running sessions: CompressStream

```ts
import { CompressStream } from 'zettel-compress'

const mem = new CompressStream({ halfLifeTurns: 50, maxZettels: 200, dedupe: true })

// on every message:
mem.push(`${role}: ${content}`)

// when answering:
const context = mem.recallContext(userQuestion, { maxTokens: 1500 })
```

- `halfLifeTurns` makes old memories fade unless repeated (`dedupe: true`
  makes repetition *refresh* a memory instead of duplicating it).
- `maxZettels` bounds memory forever — the weakest decayed zettels evict.
- **Restart story:** streams aren't serializable yet. Persist the message log
  and replay it on boot — replay is deterministic and costs ~0.1 ms/message,
  so 10,000 messages rebuild in about a second.

## 6. Multi-session / multi-user

Keep one memory per session (one KV pair, one stream). For cross-session
search, compress each session separately and query each, or merge:

```ts
import { mergeResults, recall } from 'zettel-compress'

const merged = mergeResults([sessionA, sessionB])
```

Two caveats by design: merged weights are re-normalized onto one scale, and
source offsets are dropped (they'd point into the wrong document) — so
`recallContext` over a merged result falls back to quotes. For full passages
across sessions, query per-session and concatenate.

## 7. Exact token budgets

The built-in estimate is intentionally conservative. If you already ship a
tokenizer, plug it in for exact budgets:

```ts
import { encoding_for_model } from 'js-tiktoken'
const enc = encoding_for_model('gpt-4o-mini')

injectContext(memory, {
  maxTokenBudget: 500,
  countTokens: (s) => enc.encode(s).length, // measured, never exceeded
})
```

## 8. Choosing an output format

| format | use for |
|---|---|
| `markdown` | **prompts** — models read it best (measured: 2× the QA accuracy of aaak at the same budget) |
| `aaak` | **storage** — compact, lossless, diffable |
| `json` | programmatic consumption |

## 9. Filtering memory like a database

```ts
import { injectContext, topZettels, wakeUp } from 'zettel-compress'

injectContext(memory, { flags: ['DECISION'] })            // only decisions
injectContext(memory, { minWeight: 0.7 })                 // only the heavy stuff
injectContext(memory, { maxZettels: 10, selection: 'mmr' }) // diversity-aware top-10
topZettels(memory, 5)                                     // raw zettels by weight
wakeUp(memory)                                            // one-paragraph narrative
```

Next: [Deterministic testing](./testing.md) — the recipe unique to this package.
