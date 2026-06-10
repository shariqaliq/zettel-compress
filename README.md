# zettel-compress

[![npm](https://img.shields.io/npm/v/zettel-compress)](https://www.npmjs.com/package/zettel-compress)
[![license](https://img.shields.io/npm/l/zettel-compress)](./LICENSE)

Deterministic, LLM-free text compression into structured **zettel memory units** with emotion weights, entity codes, importance flags, and inter-unit tunnel links.

Cut conversation history from 10,000 tokens to ~300–500 tokens while preserving the decisions, emotions, and entities that actually matter for LLM context.

**Zero runtime dependencies. Works in Node.js, browsers, Cloudflare Workers, and Vercel Edge.**

---

## How it works

`zettel-compress` ports the [AAAK dialect](https://mempalace.github.io/mempalace/concepts/aaak-dialect.html) from the [MemPalace](https://github.com/mempalace/mempalace) project into a pure TypeScript npm package.

Text is chunked on paragraph boundaries, then each chunk becomes a **zettel** — an atomic memory unit containing:

- **entities** — proper nouns detected by frequency (auto-coded to 3-letter codes like `ALC`, `BOB`)
- **topics** — key subject terms with CamelCase/ALL-CAPS boosts
- **quote** — the single most information-dense sentence (scored by decision-word density)
- **weight** — 0–1 importance score based on flags, emotions, and decision-word density
- **emotions** — 30 emotion states detected via keyword signals (no LLM)
- **flags** — `DECISION | ORIGIN | CORE | PIVOT | GENESIS | TECHNICAL`

**Tunnels** link zettels that share 2+ entities or 3+ topics. A **layer-1 wake-up** narrative extracts the highest-weight moments for a quick human-readable summary.

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

// Get a one-paragraph narrative of the most important moments
const summary = wakeUp(result)
```

---

## API

### `compress(text, options?): CompressResult`

Compresses a string into a `CompressResult` with `zettels`, `tunnels`, and `entityIndex`.

```ts
const result = compress(text, {
  chunkSize: 800,         // chars per chunk (default 800)
  chunkOverlap: 100,      // overlap between chunks (default 100)
  date: '2026-06-10',     // ISO date for AAAK header
  title: 'My Session',    // title for AAAK header
  minEntityFrequency: 2,  // min occurrences to count as entity (default 2)
  stopWords: ['foo'],     // extra stop words for topic extraction
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
  maxZettels: 10,          // keep top N by weight
  minWeight: 0.5,          // filter to weight >= 0.5
  flags: ['DECISION'],     // filter to specific flags only
  format: 'aaak',          // 'aaak' | 'json' | 'markdown' (default: 'aaak')
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

Parses an AAAK string back to a `CompressResult`. Handles quotes containing `|` characters safely.

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
