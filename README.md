# zettel-compress

[![npm](https://img.shields.io/npm/v/zettel-compress)](https://www.npmjs.com/package/zettel-compress)
[![license](https://img.shields.io/npm/l/zettel-compress)](./LICENSE)

Deterministic, LLM-free memory engine for LLM apps: compresses text into structured **zettel memory units** (entities, topics, key quotes, emotion signals, importance flags, and a tunnel graph linking related moments), then lets you **filter, budget, stream, and search** that memory — all without a single model call.

**Zero runtime dependencies. Works in Node.js, browsers, Cloudflare Workers, and Vercel Edge. Same input, same output, every time.**

```ts
import { compress, recall, injectContext } from 'zettel-compress'

const memory = compress(conversationHistory)

// search memory at question time — BM25 + graph expansion, no embeddings
recall(memory, 'what did we decide about authentication?', { topK: 5 })

// or inject a hard-budgeted memory block into your prompt
injectContext(memory, { maxTokenBudget: 300, format: 'markdown' })
```

---

## Measured results

Every number below is reproducible: `npm run bench` (deterministic) and `npm run bench:llm` (requires an OpenAI key in `.env`). Datasets: a real assistant conversation (~2.5k tokens) and two public-domain books — *Pride and Prejudice* (~182k tokens) and *On the Origin of Species* (~233k tokens) — each with 12 decision facts planted at seeded positions.

### Can a real model answer questions from the compressed memory?

QA accuracy with **gpt-4o-mini** answering from each context (the reply must contain the unique answer token):

| context given to the model | avg tokens | conversation | novel (182k) | science (233k) |
|---|---|---|---|---|
| nothing | — | 0% | 0% | 0% |
| first 300 tokens of the document | ~370 | 8% | 0% | 0% |
| `injectContext` top-10, markdown | 430–860 | 58% | 0% | 0% |
| `injectContext` budget-300, markdown | ~290 | 33% | 0% | 0% |
| **`recall(question)` top-5** | **90–200** | **58%** | **67%** | **75%** |

The honest read:

- **`recall()` is the headline.** From a 233k-token corpus, ~150 tokens of retrieved memory let the model answer 75% of questions — the naive same-cost baseline answers 0%. No embeddings, no API, sub-millisecond.
- **Static injection is for conversation-scale memory.** On a 19-zettel conversation, top-10 injection carries 92% of planted decision signals (58% end-to-end with the model). On a 1,085-zettel book, 10 zettels cannot cover 12 scattered facts — use `recall()` for archives.
- **Use `format: 'markdown'` when injecting directly into prompts** — models read plain quotes better than the compact AAAK lines (33% vs 17% at the same budget in our runs). Use AAAK for storage and round-tripping.

### Speed, size, and guarantees

| dataset | input tokens | zettels | compress time | throughput |
|---|---|---|---|---|
| conversation | 2,571 | 19 | 5.3 ms | ~485 tok/ms |
| novel | 182,179 | 1,085 | 757 ms | ~241 tok/ms |
| science | 233,248 | 753 | 525 ms | ~444 tok/ms |

- **Compression:** `injectContext` top-10 reduces the 233k-token text to 882 tokens (0.38%); a 300-token budget always lands ≤ its ceiling (measured 82–100% utilization, zero overruns across all tiers and datasets).
- **Lossless round-trip:** `decode(encode(result))` reproduces zettels, tunnels, and the entity index exactly — verified by deep equality on all three datasets and a 200-case property test (multi-line quotes, unicode, pipes, snake_case all survive).
- **Streaming:** `CompressStream` processes ~0.1 ms/message with bounded memory.
- **Entity detection:** 100% precision / 100% recall on the labeled benchmark fixture (10 gold entities among changelog/chat noise).

---

## How it compares

| | `zettel-compress` | mem0 / Zep | LangChain memory | embeddings RAG |
|---|---|---|---|---|
| Model calls needed | **none** | every write | every summary | every index/query |
| Marginal cost per message | **$0** | API cost | API cost | API cost |
| Deterministic / replayable | **yes, byte-exact** | no | no | no |
| Edge / browser runtime | **yes** | no (service) | partial | rarely |
| Query-time search | BM25 + graph | vector | no | vector |
| Structured output (entities, flags, links) | **yes** | partial | no | no |
| Lossless serialization format | **yes (AAAK)** | no | no | no |
| Semantic paraphrase matching | no (lexical) | yes | — | **yes** |

The trade is explicit: zettel-compress matches on words and structure, not meaning — paraphrase-heavy queries favor embeddings. In exchange you get zero cost, zero infrastructure, full determinism, and edge compatibility. For conversation memory and decision tracking, the benchmark says that trade works.

---

## How it works

Text is chunked on paragraph boundaries (overlap snaps to word boundaries; every chunk carries exact source offsets). Each chunk becomes a **zettel**:

- **entities** — proper nouns detected by capitalization evidence (sentence-start noise like `Added`, `Please` is filtered; chat speaker labels are kept), with pronoun coreference: `she`/`he` link to the most recent gender-matching entity, so a person stays attached to the conversation after their first mention
- **topics** — key terms with CamelCase/ALL-CAPS/hyphenation boosts
- **quote** — the most information-dense sentence (TextRank blended with decision-word density; falls back gracefully on lowercase chat text)
- **weight** — importance in [0, 1], rank-normalized with tie-aware midranks (equal raw scores always get equal weights; relative within a result)
- **emotions** — 30 states via word-boundary keyword matching with negation scope
- **flags** — `DECISION | ORIGIN | CORE | PIVOT | GENESIS | TECHNICAL`

**Tunnels** link zettels sharing entities/topics above a Jaccard threshold (capped per zettel). `recall()` runs BM25 over quotes+topics+entities and expands hits one associative hop along tunnels with personalized PageRank.

---

## Install

```bash
npm install zettel-compress
```

---

## Quick start

```ts
import { compress, injectContext, recall, wakeUp, CompressStream } from 'zettel-compress'

const result = compress(conversationHistory)

// hard token budget — measured output, never exceeds the ceiling
const block = injectContext(result, { maxTokenBudget: 300, format: 'markdown' })

// guarantee decisions survive selection even when ranked low
injectContext(result, { maxZettels: 10, guaranteeFlags: ['DECISION'] })

// diversity-aware selection (maximal marginal relevance)
injectContext(result, { maxZettels: 10, selection: 'mmr' })

// search memory at question time
const hits = recall(result, 'what did we decide about auth?', { topK: 5 })

// short narrative of the top moments (top 15% by weight)
const summary = wakeUp(result)

// streaming: compress each message as it arrives, bounded memory
const mem = new CompressStream({ halfLifeTurns: 50, maxZettels: 200 })
mem.push('Alice: the login service keeps timing out')
mem.push('Bob: we decided to rotate tokens hourly')
mem.recall('token decision')   // search the live stream
mem.snapshot()                 // CompressResult at any point — replayable
```

---

## API

### `compress(text, options?): CompressResult`

```ts
compress(text, {
  chunkSize: 800,          // chars per chunk (default 800)
  chunkOverlap: 100,       // overlap, snapped to word boundaries (default 100)
  date: '2026-06-12',      // ISO date for the AAAK header
  title: 'My Session',     // title for the AAAK header
  minEntityFrequency: 1,   // min occurrences to count as entity
  stopWords: ['foo'],      // extra stop words for topic extraction
  temperature: 0.5,        // softmax temperature for weight spread
  tunnelThreshold: 0.3,    // min Jaccard similarity for a tunnel
  tunnelTopK: 3,           // max tunnels per zettel
})
```

### `recall(result, query, options?): Zettel[]`

Query-time retrieval: BM25 over quote/topics/entities, optionally expanded one hop along the tunnel graph with personalized PageRank. `{ topK?: number, hops?: boolean }`. Deterministic.

### `injectContext(result, options?): string`

```ts
injectContext(result, {
  maxZettels: 10,            // top N by 0.7·weight + 0.3·signal-flag bonus
  selection: 'mmr',          // 'weight' (default) | 'mmr' diversity selection
  guaranteeFlags: ['DECISION'], // always include one zettel per flag if present
  minWeight: 0.5,            // weight floor
  flags: ['DECISION'],       // filter to flags
  format: 'markdown',        // 'aaak' (default) | 'json' | 'markdown'
  maxTokenBudget: 300,       // hard ceiling — output measured, never exceeded
})
```

Only tunnels and entity-index entries belonging to the selected zettels are emitted.

### `CompressStream`

Incremental memory for message streams. `push(text)`, `snapshot()`, `recall(query, opts?)`, `size`. Options: all of `CompressOptions` plus `halfLifeTurns` (recency decay in pushes) and `maxZettels` (bounded memory via lowest-decayed-weight eviction). Entity codes never change once assigned; replaying the same pushes reproduces a byte-identical snapshot.

### `wakeUp(result, topPct = 0.15): string`

Narrative summary of the top `topPct` zettels by weight (plus `ORIGIN`/`CORE`/`GENESIS` flags), capped at 5. Never empty on non-empty input.

### `encode(result): string` / `decode(aaak, options?): CompressResult`

AAAK v2 text serialization — fully lossless: `E:` lines carry the entity index, quotes/topics/headers are escaped (multi-line quotes, `"`, `|`, snake_case topics all survive exactly). `decode` reads v1 and v2; `{ strict: true }` throws on malformed lines, default mode collects `meta.warnings` (including header-count mismatches and unknown emotion/flag tokens).

```
FILE:002|ALC+BOB|2026-06-12|Auth Design|v2
E:ALC=Alice;BOB=Bob
001:ALC+BOB|authentication,security|"We decided to use JWT tokens."|0.91|conviction|DECISION+TECHNICAL
T:001<->002|ALC+BOB
```

### Others

`compressMany(texts, options?)` · `mergeResults(results)` (re-normalizes weights onto one scale) · `topZettels(result, n)` · `normalizeWeights(zettels, temperature?)` · `estimateTokens(text)` · `encodeZettelLine` / `encodeTunnelLine` · runtime constants `ALL_FLAGS`, `ALL_EMOTIONS`.

---

## Integration examples

### Vercel AI SDK — budgeted memory block

```ts
import { compress, injectContext } from 'zettel-compress'

const memory = compress(messages.map(m => `${m.role}: ${m.content}`).join('\n'))
const block = injectContext(memory, { maxTokenBudget: 300, format: 'markdown' })

const response = await streamText({
  model: openai('gpt-4o'),
  messages: [
    { role: 'system', content: `Relevant past context:\n${block}` },
    ...recentMessages,
  ],
})
```

### Question-time recall — only inject what the question needs

```ts
import { compress, recall } from 'zettel-compress'

const memory = compress(fullHistory)
const relevant = recall(memory, userQuestion, { topK: 5 })
const block = relevant.map(z => z.quote).join('\n')   // ~100–200 tokens
```

### Cloudflare Workers — persistent compressed memory in KV

```ts
import { compress, encode, decode, recall } from 'zettel-compress'

export default {
  async fetch(request: Request, env: Env) {
    const { sessionId, message, question } = await request.json()

    if (question) {
      const stored = await env.KV.get(`memory:${sessionId}`)
      if (!stored) return Response.json([])
      const hits = recall(decode(stored), question, { topK: 5 })
      return Response.json(hits.map(z => z.quote))
    }

    // append to the session log, store the compressed memory alongside it
    const log = ((await env.KV.get(`log:${sessionId}`)) ?? '') + '\n\n' + message
    await env.KV.put(`log:${sessionId}`, log)
    await env.KV.put(`memory:${sessionId}`, encode(compress(log)))
    return new Response('ok')
  },
}
```

---

## Emotion states detected

`conviction`, `grief`, `joy`, `fear`, `hope`, `trust`, `wonder`, `rage`, `exhaustion`, `shame`, `pride`, `nostalgia`, `anxiety`, `relief`, `anticipation`, `frustration`, `gratitude`, `loneliness`, `inspiration`, `confusion`, `clarity`, `guilt`, `awe`, `regret`, `determination`, `vulnerability`, `acceptance`, `resistance`, `love`, `loss`

## Importance flags

| Flag | Triggered by |
|---|---|
| `DECISION` | "decided", "committed", "resolved", "agreed" |
| `ORIGIN` | "founded", "created", "started", "inception" |
| `CORE` | "fundamental", "essential", "core principle" |
| `PIVOT` | "turning point", "realized", "breakthrough" |
| `GENESIS` | "led to", "resulted in", "triggered", "sparked" |
| `TECHNICAL` | "architecture", "deploy", "api", "database" |

All keyword matching is word-boundary anchored with negation-scope handling ("we never decided" does not flag).

---

## Reproducing the benchmarks

```bash
npm run bench       # deterministic: performance, compression, budgets,
                    # round-trip, answer-in-context QA, MRR, entities, streaming
npm run bench:llm   # end-to-end QA with a real model; needs OPENAI_API_KEY in .env
```

Both harnesses use seeded PRNGs — same machine, same numbers.

---

## License

MIT
