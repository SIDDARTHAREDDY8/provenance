# Architecture

```
data/*.json ──► repo.ts ──► extract/pipeline.ts ──► graph/match.ts ──► mentor/plan.ts
                            │        │                     │
                            │        └── extract/validate.ts (the gate)
                            │        └── extract/confidence.ts (derived, capped)
                            │
                            └── llm/ (Anthropic | recorded fixtures)

                    privacy/aggregate.ts ──► /org        audit.ts ──► /audit
```

## The pipeline, in order

1. **`repo.artifactsFor(personId)`** — the corpus, chronological.
2. **`extract/pipeline.ts`** — chunks into batches of 6 and calls the provider
   sequentially. Small batches keep artifact ids close to their text, which reduces
   misattributed quotes; sequential avoids silently partial profiles on a rate limit.
3. **`llm/`** — `LlmProvider` has one method. `AnthropicProvider` uses tool-use with a
   forced tool choice at `temperature: 0` for structured output. `FixtureProvider`
   replays a per-artifact recording. Selection is by presence of `ANTHROPIC_API_KEY`.
4. **`extract/validate.ts`** — the gate. Canonicalises the skill against the taxonomy
   (id, label or alias), checks the cited artifact exists, and requires the quote to
   appear in that artifact's title or body. Matching is whitespace- and
   case-insensitive, with a 20-character minimum so short quotes cannot match by
   accident. One claim yields at most one rejection reason.
5. **`extract/confidence.ts`** — confidence from evidence weight (by artifact kind),
   source independence and recency, saturating and capped at 0.95. Also returns a
   level *ceiling*: one commit cannot support "advanced" no matter what the model said.
6. **Merge** — one skill, one claim, evidence deduped per artifact keeping the longest
   quote. Level is the highest claimed, then capped by the ceiling.
7. **`graph/match.ts`** — weighted coverage with partial credit. Thin claims count as
   absent by default (`countThin: false`).
8. **`mentor/plan.ts`** — gaps × openings that build the gapped skill. Emits nothing
   when nothing would close a gap.

## Boundaries worth knowing

**`repo.ts` is the only module that touches storage.** Seed corpus is read-only JSON;
derived state is written under `.data/`, with an in-memory fallback if the filesystem
is read-only. Moving to Postgres means reimplementing that one module's methods — no
caller changes, because nothing else imports `node:fs`.

**`llm/provider.ts` owns the model contract** — prompt and tool schema live together,
so the thing the model is asked for and the thing it is validated against cannot drift
apart in separate files.

**`privacy/aggregate.ts` enforces disclosure rules, not the UI.** `SkillAggregate.counts`
is `null` when suppressed, so a caller physically cannot render a withheld number: the
suppression survives any future API or export that reuses the function.

**`audit.ts` is called at the point of inference or disclosure**, inside the action and
the page that performs it, not in a wrapper that can be bypassed.

## Interface

Server components throughout; the only client components are the two that need
`usePathname`. Mutations are server actions with `revalidatePath`. No state library, no
data-fetching library, no component library — 5 routes and one 860-line stylesheet.

The visual system treats the product as a case file rather than a dashboard, because
that is what it is: assertions about a person, each carrying a citation, some
deliberately withheld. Hence stable exhibit numbers (`lib/exhibits.ts`) that mean the
same thing on every screen, levels drawn as ordinal steppers rather than coloured
badges, and suppressed aggregates rendered as actual redaction bars — the k-anonymity
rule made visible rather than described.

## If this were real

- Connectors with incremental extraction and a per-artifact cache keyed on content
  hash, so re-extraction costs nothing for unchanged history.
- Per-skill rubrics instead of one taxonomy-wide level definition. This is the largest
  source of calibration error today.
- The gold set becomes a growing labelled corpus, with the eval gates in CI on every
  prompt change. A prompt edit that lifts recall but admits one ungrounded claim is a
  regression, and only a gate catches that.
- Row-level authorisation in the repository layer, so the visibility split is enforced
  by the query rather than by the caller remembering to ask nicely.
