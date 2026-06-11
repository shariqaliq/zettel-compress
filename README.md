# zettel-compress

[![npm](https://img.shields.io/npm/v/zettel-compress)](https://www.npmjs.com/package/zettel-compress)
[![license](https://img.shields.io/npm/l/zettel-compress)](./LICENSE)

Deterministic, LLM-free text compression into structured **zettel memory units** with emotion weights, entity codes, importance flags, and inter-unit tunnel links.

Cut conversation history from 10,000 tokens to ~100–200 tokens while preserving the decisions, emotions, and entities that actually matter for LLM context.

**Zero runtime dependencies. Works in Node.js, browsers, Cloudflare Workers, and Vercel Edge.**

---

## How it compares

Benchmarked against `node-summarizer` across five real-world datasets ranging from 190 to 10,566 tokens:

| | `zettel-compress` | `node-summarizer` (freq) | `node-summarizer` (rank) | Raw text |
|---|---|---|---|---|
| **190-token conversation** | **4t (97.9%)** | 36t (81%) | 26t (86%) | 190t |
| **1,937-token tech article** | **88t (95.5%)** | 236t (88%) | 229t (88%) | 1,937t |
| **4,878-token narrative** | **192t (96.1%)** | 333t (93%) | 164t (97%) | 4,878t |
| **8,271-token memoir** | **106t (98.7%)** | 938t (89%) | 510t (94%) | 8,271t |
| **10,566-token tech docs** | **218t (97.9%)** | 1,369t (87%) | 82t (99%) | 10,566t |
| Output type | Structured objects | Plain string | Plain string | Plain string |
| Entities extracted | ✅ Alice, Bob, Carol | ❌ | ❌ | ❌ |
| Emotion detection | ✅ 30 states | ❌ | ❌ | ❌ |
| Importance flags | ✅ DECISION, CORE, PIVOT | ❌ | ❌ | ❌ |
| Per-zettel weight score | ✅ | ❌ | ❌ | ❌ |
| Filter by weight / flag | ✅ `minWeight`, `flags` | ❌ | ❌ | ❌ |
| Hard token budget | ✅ `maxTokenBudget` | ❌ | ❌ | ❌ |
| Encode / decode round-trip | ✅ AAAK format | ❌ | ❌ | ❌ |
| Output as JSON / Markdown | ✅ | ❌ | ❌ | ❌ |
| Inter-zettel tunnel graph | ✅ | ❌ | ❌ | ❌ |
| Zero dependencies | ✅ | ❌ (2 deps) | ❌ (2 deps) | — |
| Browser / Edge safe | ✅ | ❌ Node-only | ❌ Node-only | — |
| TypeScript types | ✅ full `.d.ts` | ❌ | ❌ | — |

### What the numbers mean

**`node-summarizer`** picks N sentences and returns a plain string — fast, but structureless. On large inputs its frequency method actually produces *more* tokens than zettel-compress's `injectContext(10)` because it scales sentence count with input size. The rank method can compress more aggressively but takes 40–155ms on larger texts and still gives you no metadata.

**`zettel-compress`** always outputs a fixed budget (`injectContext(10)` = top 10 zettels regardless of input size), so reduction improves as input grows. On a 10,566-token document it emits 218 tokens — structured, filterable, and round-trippable. `wakeUp()` can trim that to ~52 tokens for the highest-importance moments only.

The tradeoff is intentional: zettel-compress compresses *selectively*, not exhaustively. You decide what gets injected — only `DECISION` flags, only weight ≥ 0.8, only the top 3 zettels, or a hard 300-token budget.

### Real output comparison (same conversation input)

**`node-summarizer` (frequency)** — sentences, no metadata:
```
The team agreed this was the right approach despite the tight deadline.
This is the core of everything we build next.
This is the most important thing we've shipped.
```

**`node-summarizer` (rank)** — different sentences, still no metadata:
```
This is the core of everything we build next.
Alice: We need to fix this before the product launch next week.
```

**`zettel-compress`** — structured, filterable, with full metadata:
```
FILE:001|AGR+ALC+BBB||
001:AGR+ALC+BBB+JWT|alice_bob_security_jwt_system|"We decided to go with rotating short-lived tokens plus a Redis-backed blocklist."|1.00|conviction+fear+exhaustion+anticipation|DECISION+ORIGIN+CORE+TECHNICAL
```

**`zettel-compress` `wakeUp()`** — narrative summary of highest-weight moments:
```
Decision: We decided to go with rotating short-lived tokens plus a Redis-backed blocklist.
```

---

## How it works

`zettel-compress` ports the [AAAK dialect](https://github.com/mempalace/mempalace) from the [MemPalace](https://github.com/mempalace/mempalace) project into a pure TypeScript npm package.

Text is chunked on paragraph boundaries, then each chunk becomes a **zettel** — an atomic memory unit containing:

- **entities** — proper nouns detected by capitalization evidence (sentence-start noise like `Added`, `Please` is filtered out; chat speaker labels are kept), auto-coded to 3-letter codes like `ALC`, `BOB`
- **topics** — key subject terms with CamelCase/ALL-CAPS boosts
- **quote** — the most information-dense sentence, scored by TextRank centrality blended with decision-word density
- **weight** — 0–1 importance score, rank-normalized via softmax so scores are always spread across the full range
- **emotions** — 30 emotion states detected via keyword signals with 6-word negation window (no LLM)
- **flags** — `DECISION | ORIGIN | CORE | PIVOT | GENESIS | TECHNICAL`

**Tunnels** connect zettels that share entities or topics above a Jaccard similarity threshold, capped at 3 tunnels per zettel to prevent graph explosion. A **layer-1 wake-up** extracts the highest-weight moments into a short human-readable narrative.

---

## Install

```bash
npm install zettel-compress
```

---

## Quick start

```ts
import { compress, injectContext, wakeUp } from 'zettel-compress'

const result = compress(conversationHistory)

// Inject top 10 zettels into your LLM context (AAAK format by default)
const context = injectContext(result, { maxZettels: 10, minWeight: 0.4 })

// Hard token budget — stop adding zettels once limit is reached
const budgeted = injectContext(result, { maxTokenBudget: 500 })

// Get a short narrative of the most important moments
const summary = wakeUp(result)
```

---

## API

### `compress(text, options?): CompressResult`

Compresses a string into a `CompressResult` with `zettels`, `tunnels`, and `entityIndex`.

```ts
const result = compress(text, {
  chunkSize: 800,           // chars per chunk (default 800)
  chunkOverlap: 100,        // overlap between chunks (default 100)
  date: '2026-06-10',       // ISO date for AAAK header
  title: 'My Session',      // title for AAAK header
  minEntityFrequency: 1,    // min occurrences to count as entity (default 1)
  stopWords: ['foo'],       // extra stop words for topic extraction
  temperature: 0.5,         // softmax temperature for weight spread (default 0.5)
  tunnelThreshold: 0.3,     // min Jaccard similarity for a tunnel (default 0.3)
  tunnelTopK: 3,            // max tunnels per zettel (default 3)
})
```

### `compressMany(texts, options?): CompressResult[]`

Compress an array of texts independently. One result per input.

### `mergeResults(results): CompressResult`

Merge multiple `CompressResult` objects into one, re-assigning globally unique zettel ids and rebuilding the entity index.

### `injectContext(result, options?): string`

Returns a filtered, formatted string ready to inject into an LLM context window.

```ts
injectContext(result, {
  maxZettels: 10,           // keep top N by weight
  minWeight: 0.5,           // filter to weight >= 0.5
  flags: ['DECISION'],      // filter to specific flags only
  format: 'aaak',           // 'aaak' | 'json' | 'markdown' (default: 'aaak')
  maxTokenBudget: 500,      // hard token ceiling (~15 tokens per zettel)
})
```

### `topZettels(result, n): Zettel[]`

Returns the top `n` zettels sorted by weight descending.

### `wakeUp(result): string`

Returns a short narrative summary of zettels where `weight >= 0.85` or flags include `ORIGIN`, `CORE`, or `GENESIS`. Returns `''` if none qualify.

### `encode(result): string`

Serializes a `CompressResult` to a compact AAAK string:

```
FILE:002|ALC+BOB|2026-06-10|Auth Design
001:ALC+BOB|authentication_security|"We decided to use JWT tokens."|0.91|conviction|DECISION+TECHNICAL
T:001<->002|ALC+BOB
```

### `decode(aaak): CompressResult`

Parses an AAAK string back to a `CompressResult`. Handles quotes containing `|` characters safely. Quotes are newline-normalized at encode time (AAAK is line-oriented), so every zettel survives the round-trip — including multi-line conversation quotes.

---

## Integration examples

### Vercel AI SDK — compress conversation history

```ts
import { compress, injectContext } from 'zettel-compress'

// Compress history every N turns
const result = compress(messages.map(m => `${m.role}: ${m.content}`).join('\n'))
const memoryBlock = injectContext(result, { maxZettels: 10, minWeight: 0.5 })

// Prepend as a system message
const response = await streamText({
  model: openai('gpt-4o'),
  messages: [
    { role: 'system', content: `Past context:\n${memoryBlock}` },
    ...recentMessages,
  ],
})
```

### LangChain.js — persistent compressed memory in KV

```ts
import { compress, encode, decode, topZettels } from 'zettel-compress'

// Store compressed memory
const aaak = encode(compress(longDocument))
await kv.set('memory:session123', aaak)

// Retrieve and inject top 5 most important zettels
const result = decode(await kv.get('memory:session123'))
const top5 = topZettels(result, 5).map(z => z.quote).join('\n')
```

### Cloudflare Workers — edge-compatible, zero Node APIs

```ts
import { compress, wakeUp } from 'zettel-compress'

export default {
  async fetch(request: Request) {
    const body = await request.text()
    const result = compress(body)
    return new Response(wakeUp(result), {
      headers: { 'Content-Type': 'text/plain' },
    })
  },
}
```

---

## Emotion states detected

`conviction`, `grief`, `joy`, `fear`, `hope`, `trust`, `wonder`, `rage`, `exhaustion`, `shame`, `pride`, `nostalgia`, `anxiety`, `relief`, `anticipation`, `frustration`, `gratitude`, `loneliness`, `inspiration`, `confusion`, `clarity`, `guilt`, `awe`, `regret`, `determination`, `vulnerability`, `acceptance`, `resistance`, `love`, `loss`

---

## Importance flags

| Flag | Triggered by |
|---|---|
| `DECISION` | "decided", "committed", "resolved", "going to" |
| `ORIGIN` | "founded", "created", "started", "inception" |
| `CORE` | "fundamental", "essential", "always", "core principle" |
| `PIVOT` | "turning point", "realized", "breakthrough", "transformed" |
| `GENESIS` | "led to", "resulted in", "triggered", "sparked" |
| `TECHNICAL` | "architecture", "deploy", "api", "database", "module" |

---

## License

MIT
