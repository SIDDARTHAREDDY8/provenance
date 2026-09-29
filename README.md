# Provenance

An agentic runtime for verified hiring. It reads a candidate's evidence pack —
pull requests, tickets, design docs, reference attestations, certificates — and
adjudicates every claim their résumé makes against it, one claim at a time, with
a citation for each verdict or no verdict at all.

Then it produces two numbers: **the score you get if you believe the résumé, and
the score the evidence supports.** The gap between them is the product.

```bash
npm install
npm run dev        # http://localhost:3210
npm run eval       # verification quality gates (TypeScript)
npm run capture    # record real model output into data/fixtures/
npm run ml:train   # train the classifier and ranker (Python)
npm run ml:eval    # ML gates + Python↔TypeScript feature parity
docker compose up  # the whole stack: web + ML service + Postgres + Redis
```

Runs with **no API key and no infrastructure**. Files instead of Postgres,
in-process queue instead of Redis, a local lexical embedder instead of a hosted
one, and authored fixtures instead of a live model. Every one of those is one
environment variable away from the real thing, and nothing downstream changes.

---

## Why this

Three numbers from the hiring literature, and what each one implies for the build:

**44% of résumés contain fabrications.** So a matching engine that reads the
résumé is measuring the wrong document. The input has to be evidence, and every
claim has to be adjudicated against it.

**ATS filters reject 88% of qualified candidates.** So the failure is not that
screening is too permissive, it is that it screens on unverified text. Raising
the bar on an unreliable signal removes good candidates faster than bad ones.

**Mobley v. Workday, the EU AI Act, FCRA.** So who decided, on what evidence,
under which rule, has to be answerable six months later — which is a property of
the architecture, not a report you can generate afterwards.

## The finding that shaped the retrieval design

Retrieval by similarity cannot find a contradiction, and that is not a weakness
of the embedder — it is what similarity means.

Measured on this corpus with `all-MiniLM-L6-v2`:

```
"Led a team of 8 engineers"
"She did not have direct reports at any point"      cosine  −0.02
```

The single most decisive pair in the evidence pack scores as **unrelated text**,
because the second sentence is the answer precisely by meaning the opposite of
the first. A better embedding model does not fix this.

So the two jobs are separated:

- **Supporting evidence is a similarity problem.** Semantic embeddings handle it,
  and measurably better than lexical — switching cut citations to non-retrieved
  documents from 7 to 4 and moved verified fit from 20% to 35%.
- **Contradicting evidence is a structural problem.** For claims about scope,
  employment or credentials, *every* attested third-party document enters the
  context and the adjudicator reads them all. Reference checks are few, short,
  and written by someone other than the candidate. You do not rank them. You
  read them.

A gate in `corroborate.ts` enforces the consequence: **a verdict may only cite
documents that retrieval actually returned for that claim.** A citation to a
document the adjudicator was never shown is unfounded even when the quote is
real — it means the verdict came from somewhere other than the evidence.

That gate is also what caught this: the hand-written fixtures had been citing
referee documents the retriever never surfaced, quietly flattering the pipeline.

## The four things that make it defensible

### 1. A verdict without a resolvable citation does not exist

`web/src/lib/verify.ts` string-matches every quoted span against the document it
names. A citation that cannot be found is rejected before scoring, and a
supportive verdict left with no surviving citation is **downgraded, not kept**.

The fixture corpus contains a deliberate fabrication — the model claims a
candidate ran the hiring loop and invents a quote from a performance review to
prove it. It is caught on every run, including in CI.

### 2. Four verdicts, because "unsupported" is not "lying"

`verified` · `partially_verified` · `unsupported` · `contradicted`

*Unsupported* means nothing in the pack speaks to the claim either way. Collapsing
that into "unverified" and treating it as a negative is how a verification
product turns into a defamation product. The demo candidate has one genuinely
unsupported claim and two contradicted ones, and the system says which is which.

### 3. The model never decides

Two steps call an LLM: splitting the résumé into discrete claims, and
adjudicating each claim against retrieved evidence. **Scoring and the decision
are deterministic code** — thresholds in one readable file, reproducible, no
sampling.

Every adverse outcome carries `requiresHumanSignoff` and cannot leave the system
until a named person accepts it, with the disclosable factors listed. A rule that
lives inside a sampled generation cannot satisfy the EU AI Act's human-oversight
requirement, and cannot be defended in the litigation this category is now in.

### 4. Corrections are training data, not database edits

Any reviewer can disagree with a verdict. The change, the reason and the reviewer
are recorded, and the case is promoted into the eval set. A disagreement the
system never measures again is one it will repeat next quarter — and on an
adverse verdict, repeating it costs somebody a job.

## What you are looking at

| Screen | What it shows |
|---|---|
| **Queue** `/` | Every application with claimed vs verified fit, ordered by a learned review-priority score |
| **Assessment** `/applications/[id]` | 14 claims, each with a verdict, its citations, its confidence, and a correction form |
| **Trace** `/applications/[id]/trace` | All four agent steps with the gates each ran on its own output, and the retrieval behind every claim |
| **Compliance** `/compliance` | Adverse-impact monitor against the four-fifths rule, with k-anonymity suppression |
| **Corrections** `/corrections` | The human override log, and what it feeds |
| **Audit** `/audit` | Every inference and disclosure, written where it happens |

## Evals

Two suites, because the failure modes are different.

**`npm run eval`** — verification quality:

```
Pipeline steps
  extract        ok     1 call  · 2/2 checks
  corroborate    ok    18 calls · 4/4 checks
  score          ok     0 calls · 2/2 checks
  adjudicate     ok     0 calls · 3/3 checks

Verdict accuracy     94.4%   17/18   (one honest disagreement, see below)
Adverse precision   100.0%    5/5 adverse calls correct
Adverse recall      100.0%    5/5 adverse claims caught
Retrieval recall    100.0%   15/15 deciding documents retrieved
Grounding                    31 citations, all from retrieved evidence
Adversarial probe            fabricated quote, phantom document and
                             out-of-context quote all rejected
Claimed fit 60%  ·  Verified fit 35%  ·  Inflation 25 points
```

These are measurements, not a fixture agreeing with itself. The verdicts come
from a real model run; the gold labels were written by hand from the evidence
pack before comparing. The one residual disagreement is claim_02, where the
model reads the résumé's skills summary as partially verified and I read it as
verified — which is the kind of thing a rubric has to settle, not a prompt.

**Retrieval recall is scored separately on purpose.** An adjudicator cannot be
better than its context, and without that axis "the model judged badly" and "the
model was never shown the deciding document" both surface as a verdict error
while needing opposite fixes. That distinction was not theoretical: the first
live run produced an adverse verdict that was correct given its context and
wrong given the full pack, because the one document showing the claimed effect
never made the cut. The fix was `k = 6 → 8`, not a better prompt.

Adverse **precision** is gated above recall on purpose: a false adverse verdict
is a person not hired for a reason that was not true. Missing one is a worse
candidate experience; inventing one is a wrong that cannot be undone.

**`npm run ml:eval`** — model quality and training/serving skew:

```
Held-out synthetic (n=800)   roc_auc 0.865
Real fixture claims (n=18)   roc_auc 0.908
Feature parity vs TypeScript 18 cases, 0 mismatches
```

That third line is the one that matters. Features are computed in TypeScript at
serving time and in Python at training time; the suite asserts the two
implementations agree feature for feature. Silent skew does not show up in
accuracy numbers, it shows up as quietly worse verification a quarter later.

## The stack, and why each piece is there

| Layer | Choice | Swap |
|---|---|---|
| App | Next.js 16, App Router, server components/actions, TypeScript strict | — |
| Styling | Tailwind v4, CSS-first `@theme` tokens | — |
| Agent runtime | Typed steps, retries with backoff, per-step output gates, full trace | `web/src/lib/agents/runtime.ts` |
| LLM | Forced tool use, `temperature: 0` | `ANTHROPIC_API_KEY` → API; `LLM_PROVIDER=claude-code` → CLI login; absent → replayed fixtures |
| Retrieval | Chunking, local sentence-transformer, cosine + MMR, attested evidence included not ranked | `EMBEDDING_PROVIDER=openai` / `=lexical` |
| ML | scikit-learn training in Python, coefficients exported, inference in TypeScript | `ml/` |
| Storage | File store, mtime-revalidated; audit log append-only JSONL | `DATABASE_URL` → Postgres (`db/schema.sql`) |
| Queue | In-process, at-least-once, bounded retries | `REDIS_URL` → reliable-queue on Redis |
| Billing | Metered per completed run, idempotent on application id | `STRIPE_SECRET_KEY` |

**Cost shape.** Corroboration is per candidate; scoring is per role. One
candidate applying to two roles costs 19 model calls, then 0 — the second run
reuses the verdicts and only re-scores, and its trace says `extract:skipped
corroborate:skipped`. This was a README claim before it was working code; a live
run showed 19 calls both times, which is the sort of thing a project about
unverified claims should not be shipping.

**Why ML at all when there is an LLM?** Because the classifier answers a
different question: *before* spending a model call per claim, which claims are
likely to fail verification? That is triage, it runs on twelve features and a dot
product, and using a language model for it would be slower, dearer and less
inspectable. It orders work; it never touches a verdict.

**Why Python and TypeScript?** Training, metrics and the feature contract belong
where scikit-learn lives. Serving a logistic regression does not need a model
server — it is a dot product, so the exported coefficients are read directly by
the app. `ml/` also serves entity resolution and batch scoring over HTTP for
anything that wants a Python runtime.

## Honest limits

- **The committed fixtures are real captured output**, written verbatim by
  `npm run capture` and replay-verified. What is synthetic is the *corpus* — the
  résumé and evidence pack are written, not sampled from a real candidate.
- **The gold labels are mine**, hand-written from the evidence pack. Eighteen
  claims is a smoke test, not a benchmark.
- **Training data is synthetic**, from a generator documented in `ml/app/synth.py`.
  The reported metrics are a statement about that process, not about the world.
  The 14 real fixture claims are a smoke test, not a measurement — n=14.
- **One candidate has a real evidence pack.** The other three applications are
  seeded so the queue, the ranker and the aggregate view have a population.
- **The cohort on `/compliance` is seeded** so the monitor has something to
  measure, with one group deliberately below threshold — a monitor that never
  fires is indistinguishable from one that does not work.
- **Retrieval runs a local model by default** (~90MB on first run, cached). If it
  cannot load it falls back to the lexical embedder with a warning rather than
  failing. At corpus scale the index belongs in pgvector — `db/schema.sql` says
  where — and `includeAllAttested` would need a cap.
- **No authentication.** Reviewer identity is typed into a form. The visibility
  and signoff rules are modelled and enforced in the layers that own them, but
  there is no login.

## What I would build next, in order

1. **Candidate-side disclosure.** Today the adverse factors are computed and shown
   to the reviewer. Under GDPR Article 22 and FCRA adverse-action rules they
   belong in front of the candidate, with a route to contest — which is the same
   correction loop, pointed the other way.
2. **Evidence-pack ingestion.** GitHub, Jira and Google Docs connectors with
   incremental extraction and content-hash caching, so re-assessment costs
   nothing for unchanged history.
3. **Per-claim-type adjudication rubrics.** One prompt defining four verdicts
   across five claim categories is the largest remaining source of error. A
   credential and a scope claim are not judged the same way.
4. **pgvector, and a reranker.** Lexical retrieval is the weakest link in the
   chain; a claim that retrieves nothing is unsupported regardless of the truth.
