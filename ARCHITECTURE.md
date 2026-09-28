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
IDF fitted on *this* corpus rather than a global one, and MMR on retrieval so one
document cannot supply all six hits. Corroboration from one source is weaker than
corroboration from three, and the retrieval should reflect that.

**`store/`** — the only module that touches persistence. `FileStore` and
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

## Cost shape

Corroboration is **per candidate**; scoring is **per role**. A second application
from the same person reuses the verdicts and costs zero model calls. At fourteen
claims and one call each, that is the difference between assessing a candidate
once and assessing them once per job they apply to.

## What would change at scale

- **Retrieval into pgvector**, with the chunk table and embedding column sketched
  in `db/schema.sql`. The lexical embedder is a stand-in, not a position.
- **A durable workflow engine** in place of the queue once steps need to survive
  process restarts mid-run. The step boundaries are already the right ones.
- **Per-claim-type rubrics**, and the eval suite split per category — the single
  adjudication prompt is the largest remaining source of error.
- **Row-level authorisation in the store**, so the visibility rules are enforced
  by the query rather than by every caller remembering to ask nicely.
