# Getting started

zettel-compress turns long text — conversation history, meeting notes,
documents — into a compact, structured, **searchable** memory object, entirely
inside your process. No model calls, no services, no vector store. The same
input always produces byte-identical memory.

```bash
npm install zettel-compress
```

## The mental model

```
            compress(text)                recallContext(memory, question)
  raw text ───────────────► CompressResult ─────────────────────────────► passages for your LLM
  (any size)                  │
                              ├─ zettels[]      one per ~800-char chunk: entities, topics,
                              │                 key quote, weight, flags, emotions, source offsets
                              ├─ tunnels[]      links between zettels that share entities/topics
                              ├─ entityIndex    Alice ⇄ ALC code table
                              └─ meta.source    the normalized input (for passage expansion)
```

Three verbs cover almost every use:

1. **`compress(text)`** — build the memory. ~250–500k tokens/sec.
2. **`recallContext(memory, question, { maxTokens })`** — get ready-to-inject
   passages answering a question. This is the workhorse.
3. **`injectContext(memory, { maxTokenBudget, format })`** — get a standing
   memory block (no question), budgeted and formatted.

```ts
import { compress, recallContext, injectContext } from 'zettel-compress'

const memory = compress(conversationHistory)

// question-time: ~100–2000 tokens of the passages that matter
const context = recallContext(memory, 'what did we decide about auth?', {
  topK: 10,
  maxTokens: 2000,
})

// standing block: top moments under a hard budget, markdown for prompts
const block = injectContext(memory, { maxTokenBudget: 300, format: 'markdown' })
```

## What a zettel is

Each ~800-char chunk of input becomes one zettel:

| field | meaning |
|---|---|
| `quote` | the chunk's most information-dense sentence |
| `entities` | proper nouns, with pronoun coreference ("she" → Alice) |
| `topics` | key terms |
| `weight` | importance in [0, 1] — **relative within one result**, rank-normalized; don't compare across results |
| `flags` | `DECISION`, `ORIGIN`, `CORE`, `PIVOT`, `GENESIS`, `TECHNICAL` (keyword-triggered) |
| `emotions` | lexicon-detected signals — useful for filtering, not sentiment analysis |
| `sourceStart` / `sourceEnd` | exact offsets into `meta.source` — provenance |

Retrieval matches against the **full source chunk** (not just the quote), and
`recallContext` returns full passages — so details that didn't make the quote
are still found and returned.

## Persistence

Memory serializes to AAAK, a compact line-oriented text format — diffable,
versionable, losslessly round-trippable:

```ts
import { encode, decode } from 'zettel-compress'

const aaak = encode(memory)            // string — store it anywhere
const restored = decode(aaak)          // CompressResult again
decode(aaak, { strict: true })         // throw on malformed lines instead of warning
```

**The one thing AAAK does not carry is the original text** (`meta.source`) —
the format stays small on purpose. Source *offsets* survive, so to get full-
passage recall after decoding, store the raw text alongside the AAAK string
and pass it back:

```ts
recallContext(restored, question, { source: rawText })
```

If you don't, `recallContext` falls back to quotes — still useful, less
complete. Rule of thumb: **store the log + the AAAK; the AAAK is the index,
the log is the payload.**

## Streaming (chat applications)

```ts
import { CompressStream } from 'zettel-compress'

const mem = new CompressStream({
  halfLifeTurns: 50,   // recency decay: weight halves every 50 messages
  maxZettels: 200,     // bounded memory: weakest decayed zettels evicted
  dedupe: true,        // re-sent boilerplate refreshes recency instead of duplicating
})

mem.push(`${role}: ${content}`)        // per message — ~0.1 ms
mem.recallContext('what broke last week?')
mem.snapshot()                         // a CompressResult at any moment
```

The stream is a pure function of its pushed messages: replaying the same
messages reproduces a byte-identical snapshot. (Note: a stream object itself
isn't serializable yet — persist the message log and replay it on restart;
that's cheap at ~0.1 ms/message.)

## Options you'll actually touch

```ts
compress(text, {
  chunkSize: 800,        // smaller = finer retrieval units, more zettels
  keepSource: true,      // default; false drops meta.source to halve memory
  dedupe: true,          // merge near-duplicate chunks (chat boilerplate)
  verboseLabels: true,   // tunnel labels as Alice+Bob instead of ALC+BBB
})

injectContext(memory, {
  format: 'markdown',    // for prompts; 'aaak' for storage; 'json' for code
  maxTokenBudget: 300,   // measured, never exceeded
  guaranteeFlags: ['DECISION'],  // a decision always makes the cut
  countTokens: myTiktokenCounter, // exact budgets if you have a tokenizer
})
```

Everything else (tunnel thresholds, softmax temperature, stop words) has sane
defaults — see the README API section.

## What it is not

- It matches **words and structure, not meaning** — paraphrase-heavy recall
  favors embeddings. We publish benchmark numbers on exactly this trade.
- It does not generate answers — it retrieves the context your model answers
  *from*.
- The emotion layer is a lexicon signal, not sentiment analysis.

Next: [Integration recipes](./recipes.md) · [Deterministic testing](./testing.md)
