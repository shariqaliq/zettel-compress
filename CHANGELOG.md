# Changelog

All notable changes to zettel-compress. Benchmark numbers are reproducible
with `npm run bench` (deterministic) and `npm run bench:llm` (model-judged).

## Unreleased

### Added
- **Provenance-expanded recall (small-to-big retrieval)**: zettels carry
  exact `sourceStart`/`sourceEnd` offsets, `compress()` keeps the normalized
  input on `meta.source` (opt out with `keepSource: false`), and the new
  `recallContext(result, query, { topK, hops, maxTokens, source })` returns
  merged full source passages in document order instead of single quotes.
  BM25 now indexes the full source chunk when available. Offsets serialize
  in AAAK as an optional trailing span field; the source text never does.
  `CompressStream` maintains a source log and exposes `recallContext`;
  `mergeResults` drops offsets that would point into the wrong document.
- **LoCoMo-10 evaluation harness** (`npm run bench:locomo`): full protocol
  over all 1,986 questions, token-F1 + substring scoring per category,
  abstention scoring for the adversarial set, rate-limit-aware retries.
  Measured impact of provenance expansion: overall F1 (categories 1–4)
  5.9 → 41.6, single-hop 8.0 → 57.0, temporal 1.3 → 23.6, answer-in-context
  9.7% → 38.0%, at ~1.7k context tokens/question. Adversarial abstention
  95.5% → 87.4% (richer context tempts more answers).

## 0.2.1 — 2026-06-12

### Added
- GitHub Actions publish workflow: pushing a `v*` tag automatically runs
  `prepublishOnly` (zero-dep check, build, tests, typecheck) and publishes
  to npm via `NPM_TOKEN` — no manual `npm publish` needed for future releases.

## 0.2.0 — 2026-06-12

### Added
- **MinHash/LSH tunnel building at scale**: above 500 zettels, candidate
  pairs come from LSH banding instead of all-pairs comparison — 10,000
  zettels link in ~390 ms (~60× faster), 50,000 in ~3 s. Candidates are
  verified with the exact scorer, so tunnel semantics are unchanged.
- **`dedupe` / `dedupeThreshold` compress options**: near-duplicate zettels
  merge (union-find); the highest-weight copy survives and absorbs entities,
  topics, emotions, and flags. In `CompressStream`, a re-sent message
  refreshes the recency of the zettel it duplicates instead of growing the
  stream.
- **Suffix folding in `recall()`**: plural/-ed/-ing/-ion/-ly inflections fold
  to a shared stem on both documents and queries, so "credential rotation"
  matches "rotating credentials". Fixes zero-overlap misses; planted-fact
  benchmark scores are unchanged (its misses are ranking competition, not
  vocabulary).
- **Centrality-blended weights**: degree on the tunnel graph feeds into
  importance (0.8·content + 0.2·centrality) before normalization, in
  `compress`, `mergeResults`, and `CompressStream`. Structurally central
  zettels rank higher; tunnel-less results are unaffected. Trade-off note:
  conversation-scale top-10 signal coverage measured 92% → 83% as connected
  context displaces one isolated fact.
- **`InjectOptions.countTokens`**: plug in an exact tokenizer (e.g.
  js-tiktoken) for budget enforcement; the built-in estimate stays the
  zero-dependency default.
- **`verboseLabels` compress option**: tunnel labels with entity names
  (`Alice+Bob`) instead of 3-letter codes.
- **Degenerate-input warning**: `compress()` attaches `meta.warnings` when
  the input is too short for meaningful compression.
- CI workflow: zero-dep check, typecheck, build, and tests on Node 18/20/22.

## 0.1.4 — 2026-06-12

### Added
- `recall(result, query, { topK, hops })`: BM25 over quotes/topics/entities
  blended with personalized PageRank over the tunnel graph. Measured with
  gpt-4o-mini: 58–75% QA accuracy at ~90–200 context tokens on 2.5k–233k
  token corpora; same-token-cost baselines 0–8%.
- `CompressStream`: incremental compression with recency decay
  (`halfLifeTurns`), bounded memory (`maxZettels`), cross-push pronoun
  resolution, and byte-exact replay.
- AAAK v2 serialization: `E:` entity-index lines, full escaping (multi-line
  quotes, `"`, `|`, snake_case topics), strict decode mode, `meta.warnings`,
  emotion/flag validation. Lossless round-trip is property-tested (200 seeded
  cases) and verified by deep equality on real corpora. v1 output still
  decodes.
- Selection quality: ranking by 0.7·weight + 0.3·signal-flag bonus,
  `guaranteeFlags`, and `selection: 'mmr'` diversity mode.
- Pronoun coreference: high-precision recency sieve with a given-name
  gazetteer; `they` binds to the two most recent entities.
- Benchmark harnesses: `npm run bench` (deterministic, real large datasets)
  and `npm run bench:llm` (model-judged QA).

### Fixed
- Token budgets are measured on rendered output and never exceed the ceiling
  (was: flat estimate, up to 38% over; later also fixed: whitespace-free
  AAAK lines hiding from the estimate, and the inject path serializing the
  whole document's entity index).
- Weight normalization uses midranks: equal raw scores get equal weights;
  `mergeResults` re-normalizes onto one scale.
- Chunk overlap snaps to word boundaries; `charStart`/`charEnd` are exact
  source offsets (`chunk.text === normalized.slice(charStart, charEnd)`).
- Sentence splitting falls back to newline/punctuation boundaries on
  lowercase chat text.
- `wakeUp()` uses a top-percentile threshold instead of a hardcoded 0.85;
  never empty on non-empty input.
- `injectContext` only emits tunnels whose endpoints are selected.

## 0.1.3 — 2026-06-11

### Fixed
- `node-summarizer` moved from `dependencies` to `devDependencies` — the
  zero-runtime-dependency claim is now true; `prepublishOnly` enforces it.
- AAAK encode strips newlines from quotes so multi-line quotes no longer
  cause zettels to be silently dropped on decode (was 18 encoded → 11
  decoded on real conversation text).
- Flag/emotion keyword matching is word-boundary anchored ('api' no longer
  matches "rapid", 'miss' no longer matches "mission").
- Entity detection filters sentence-start capitalization noise with
  capitalization evidence (~20% → ~85% precision on the benchmark
  conversation); STOP_LIST extended with titles, roles, document-structure
  words, ordinals, and common sentence-opening verbs.
- Performance test thresholds relaxed on slow machines (exact under
  `ZC_PERF_STRICT=1`).
