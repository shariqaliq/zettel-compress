# Deterministic testing

The property that separates zettel-compress from every LLM- or embedding-based
memory: **the same input produces byte-identical memory, on every machine,
every time.** That makes agent memory *testable* — snapshot tests, replay
tests, and golden files all work, with no mocks and no flakes.

This is impossible with mem0/Zep (LLM writes are nondeterministic) and
unreliable with embeddings (model/version drift changes vectors). Here it's a
guarantee.

## 1. Snapshot-test your agent's memory

Treat memory like rendered output — encode it and snapshot it:

```ts
import { describe, it, expect } from 'vitest'
import { compress, encode } from 'zettel-compress'
import { FIXTURE_CONVERSATION } from './fixtures'

it('memory of the support conversation is stable', () => {
  const memory = compress(FIXTURE_CONVERSATION)
  expect(encode(memory)).toMatchSnapshot()
})
```

A failing snapshot means your *input pipeline* changed (message formatting,
ordering, truncation) or you upgraded zettel-compress — both things you want
a diff for in code review. The AAAK diff is human-readable line-per-memory.

## 2. Assert what the agent will remember

Test memory *content* the way you test business logic:

```ts
import { compress, recallContext, injectContext } from 'zettel-compress'

it('the refund decision survives compression and is recallable', () => {
  const memory = compress(longSupportThread)

  // it must survive a 300-token budget
  const block = injectContext(memory, { maxTokenBudget: 300, format: 'markdown' })
  expect(block).toContain('refund')

  // and be retrievable by a natural question
  const ctx = recallContext(memory, 'what did we agree about the refund?')
  expect(ctx).toContain('full refund within 14 days')
})

it('decisions always make the cut regardless of ranking', () => {
  const block = injectContext(memory, { maxZettels: 10, guaranteeFlags: ['DECISION'] })
  expect(block).toMatch(/DECISION/)
})
```

These tests run in milliseconds with zero network — they belong in the unit
suite, not the e2e suite.

## 3. Replay-test long-running streams

A `CompressStream` is a pure function of its pushed messages:

```ts
import { CompressStream, encode } from 'zettel-compress'

it('replaying the session log reproduces memory byte-for-byte', () => {
  const a = new CompressStream({ halfLifeTurns: 50, maxZettels: 200 })
  const b = new CompressStream({ halfLifeTurns: 50, maxZettels: 200 })
  for (const msg of sessionLog) { a.push(msg); b.push(msg) }
  expect(encode(a.snapshot())).toBe(encode(b.snapshot()))
})
```

In production this same property means crash recovery is trivial: replay the
log, get the identical memory state — no checkpoint consistency problems.

## 4. Golden-file regression for prompt budgets

Pin the exact context your model receives, so a dependency bump can never
silently change your prompts:

```ts
import { readFileSync } from 'node:fs'

it('the injected context for the demo session is unchanged', () => {
  const block = injectContext(compress(DEMO_SESSION), {
    maxTokenBudget: 500,
    format: 'markdown',
  })
  expect(block).toBe(readFileSync('./golden/demo-session-500.md', 'utf8'))
})
```

When it fails after an upgrade, the diff *is* the changelog of what your
model will now see differently. Review it like any other diff.

## 5. Property tests, if you want to go further

Determinism makes property-based testing practical:

- `decode(encode(m))` deep-equals `m` for any memory (we ship 200 seeded
  cases of exactly this in our own suite)
- `injectContext(m, { maxTokenBudget: n })` never exceeds `n` for any `n`
- compress(text) is invariant under `\r\n` vs `\n` line endings

## Why this matters

Agent bugs are disproportionately *memory* bugs: the model was fine, but it
was handed the wrong context. With nondeterministic memory those bugs are
unreproducible by definition. With deterministic memory they're a failing
test with a readable diff — which is the difference between debugging an
agent and debugging a weather system.
