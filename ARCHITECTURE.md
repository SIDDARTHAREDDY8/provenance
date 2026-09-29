# Architecture

```
                        ┌──────────────────────────────────────────┐
  résumé ──────────────►│  extract      LLM · forced tool use      │
  evidence pack ───────►│               gate: claims are verbatim  │
        │               └──────────────┬───────────────────────────┘
        │                              ▼
  ┌─────▼──────┐        ┌──────────────────────────────────────────┐
  │  chunk +   │───────►│  corroborate  LLM · one call per claim   │
  │  embed +   │  top-k │               RAG over the evidence pack │
  │  MMR       │        │               gate: citations resolve    │
  └────────────┘        └──────────────┬───────────────────────────┘
                                       ▼
                        ┌──────────────────────────────────────────┐
                        │  score        deterministic              │
                        │               claimed vs verified        │
                        │               gate: cannot inflate       │
                        └──────────────┬───────────────────────────┘
                                       ▼
                        ┌──────────────────────────────────────────┐
                        │  adjudicate   deterministic policy       │
                        │               gate: adverse ⇒ signoff    │
                        └──────────────────────────────────────────┘

  queue ──► worker ──► assess() ──► store ──► audit ──► Stripe meter
```

## The boundary that matters

Two steps call a model. Two do not, and that is a design decision rather than an
optimisation.

**Extraction and corroboration are judgement about text**, which is what language
models are for. **Scoring and the decision are policy**, which has to be
reproducible, inspectable line by line, and attributable to a rule with an owner.
A threshold inside a sampled generation cannot be diffed, cannot be tested, and
cannot be explained to a regulator or a court. Both of those audiences now exist
for this category.

## Module boundaries

**`agents/runtime.ts`** — steps declare themselves, run with bounded retries, and
report the gates they ran on their own output. A failed gate is a failed attempt,
so a step never emits output it has itself judged unsound. The trace is a
by-product, not instrumentation bolted on afterwards.

**`verify.ts`** — the only place a citation becomes trusted. Normalised
containment (whitespace- and case-insensitive, 20-character minimum) rather than
character equality: strict equality rejects good citations re-wrapped out of a
multi-line body and teaches nothing, while normalised containment still makes a
fabricated quote impossible to pass.

**`rag/`** — chunking with sentence-boundary preference so spans stay quotable,
MMR so one document cannot supply all six hits, and reserved slots for attested
evidence. The embedder is swappable; the lexical one keeps its corpus-fitted IDF
as an offline fallback.

The load-bearing decision is that retrieval has two jobs, not one. Finding
*supporting* evidence is a similarity problem and gets semantic search. Finding
*contradicting* evidence is not — measured here, the most decisive pair in the
corpus scores −0.02 cosine, because a contradiction is not a paraphrase. That
half is handled by structure: for claims a third party is authoritative about,
every attestation enters the context.

`corroborate.ts` then gates on it — a verdict may only cite what retrieval
returned for that claim.

**`store/`** — the only module that touches persistence. The file driver
revalidates its read cache on mtime, and the audit log is append-only JSONL
rather than a rewritten array. Both were bugs first: a dev server and a CLI
script each holding a stale copy read-modify-wrote over each other, and an
entire assessment's audit trail vanished. A log with a read-modify-write cycle
is not a log.

 `FileStore` and
`PostgresStore` implement one interface; nothing outside the directory knows
which is live. Both singletons are pinned to `globalThis`, because Next bundles
route handlers, server actions and pages separately and a plain module singleton
can exist several times in one process.

**`queue/`** — same shape. The in-process driver implements the same contract as
Redis (at-least-once, bounded retries with backoff, terminal failure recorded),
so a handler written against one behaves identically on the other. The Redis
driver uses a reliable-queue pattern: ids move atomically to an in-flight list
and are removed only after the handler returns, so a worker dying mid-run leaves
recoverable state rather than losing an assessment silently.

**`ml/`** — training, metrics and the feature contract in Python; inference in
TypeScript from exported coefficients. `FEATURE_VERSION` is checked at load, and
a model trained on a stale feature set is refused rather than served.

**`compliance/adverse-impact.ts`** — suppression is enforced where the numbers are
computed, and `counts` is `null` when withheld, so a caller cannot render a
suppressed figure by accident. The reference rate for the four-fifths ratio is
computed over reportable groups only, or a suppressed group's rate leaks through
its own ratio.

**Cache keys are namespaced by candidate.** Corroboration is cached as
`corroborate/<candidateId>/<claimId>`. It was keyed on the claim id alone, and
claim ids restart at `claim_01` for every person — so capturing a second
candidate silently overwrote the first, and a live system would have served one
person's verdicts for another. Found by adding a second candidate.

## Cost shape

Corroboration is **per candidate**; scoring is **per role**. A second application
from the same person reuses the verdicts and costs zero model calls — the trace
records both skipped steps rather than quietly omitting them, because "this was
free" is a claim a reader should be able to check.

Staleness is keyed on the size of the evidence pack: add a reference and the
verdicts are recomputed, because new evidence can overturn one. That is coarse —
a document edited in place slips through — and a real system would hash the
pack. It is named in `findReusableCorroboration` rather than left implicit.

## What would change at scale

- **Retrieval into pgvector**, with the chunk table and embedding column sketched
  in `db/schema.sql`. The lexical embedder is a stand-in, not a position.
- **A durable workflow engine** in place of the queue once steps need to survive
  process restarts mid-run. The step boundaries are already the right ones.
- **Per-claim-type rubrics**, and the eval suite split per category — the single
  adjudication prompt is the largest remaining source of error.
- **Row-level authorisation in the store**, so the visibility rules are enforced
  by the query rather than by every caller remembering to ask nicely.
