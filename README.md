# Contribution Graph

An evidence-linked skills graph and internal-mobility engine. It reads an employee's
actual work — pull requests, tickets, commits, design docs, written reviews — and
produces a skill profile where **every claim cites the sentence that proved it**.
Then it scores that profile against real roles, and turns the gaps into actions bound
to real openings.

Built as a work sample for Astoria AI. It is a small, sharper version of the four
things Astoria ships: Status Quo, Career Path, AI Mentor and Talent Intelligence.

```bash
npm install
npm run dev     # http://localhost:3210
npm run eval    # extraction quality gates
```

No API key required. With `ANTHROPIC_API_KEY` unset the app replays a recorded
extraction; every step after the model call is the same code, so the offline demo is
not a different product. Set the key in `.env.local` to run it live.

---

## Why this and not a career chatbot

Three claims, each one built rather than asserted.

### 1. Self-assessment is the wrong input

Every talent product in this category asks people to rate themselves, or reads job
titles out of an HRIS. Both are stale, inflated and inconsistent between teams — and
then an AI layer gets built on top, so the recommendations inherit the garbage.

Meanwhile every knowledge worker produces a continuous, honest record of what they
actually did. What changed in the last two years is not that a model can give career
advice; it is that extracting structure from that record became cheap enough to do
continuously. **The pipeline is the moat. The mentor is the interface.**

### 2. A claim without traceable evidence is a defect, not a caveat

The extractor must quote verbatim from a specific artifact. The validator
(`src/lib/extract/validate.ts`) string-searches every quote against its cited source
and **discards anything it cannot find**. Rejections are shown in the UI rather than
silently dropped, because the rejection rate is how you know what the surviving
claims are worth.

The fixture corpus contains three deliberate extractor failures — a fabricated quote,
an off-taxonomy skill, a citation to a nonexistent artifact — so this path is
exercised on every single run, including in the eval suite.

The load-bearing example: the corpus includes an RFC where the engineer discusses
Kafka at length and states plainly that she has **no** production streaming
experience. A keyword-proximity extractor credits her for stream processing. This one
does not, and `npm run eval` fails the build if it ever starts to.

### 3. A mentor with no action surface is a demo

`src/lib/mentor/plan.ts` will not emit a recommendation unless something in the
company would actually close the gap — an open ticket that builds the skill, a
requisition, a named colleague with a pairing slot. Every action carries the measured
gap that produced it (`because: { skillId, fromLevel, toLevel }`).

If nothing in the system would close a gap, **no action is offered for it**. Saying
"develop your stream processing skills" is free to generate and worth nothing, and
that is most of what this category ships.

### And underneath: the trust boundary

The employer pays; the employee supplies the data. Nobody tells an employer-owned
mentor they are thinking of leaving, so the visibility split is a product constraint
rather than a compliance checkbox.

`src/lib/privacy/aggregate.ts` enforces two rules in the aggregation layer, not the
UI — a rule enforced in the UI leaks through the API on the first integration:

- **Opt-out is absolute.** A skill the employee marked private is excluded from the
  count, not counted-and-hidden.
- **k-anonymity (k=5).** A bucket is reported only when at least five people are in
  it. "One person on your team has thin Kubernetes evidence" is a performance
  conversation conducted through a dashboard nobody agreed to.

Every inference and every disclosure is appended to an audit log at the point it
happens. Under the EU AI Act, worker-management systems fall in the high-risk
category, which carries record-keeping and human-oversight obligations. Logging at
the point of inference is cheap; reconstructing who saw what six months later is not
possible at all. In DACH enterprise sales this is also what gets you past a works
council.

---

## What you are looking at

| Screen | What it shows |
|---|---|
| **Evidence** (`/`) | 22 artifacts → 42 raw claims → 15 merged skills, 3 rejected. Every claim expands to its source quotes. |
| **Where you could go** (`/paths`) | Four roles scored with partial credit. Thin-evidence skills do not count toward a requirement. |
| **Mentor** (`/mentor`) | Gaps turned into bound, requestable actions, ranked by expected closure. |
| **Org view** (`/org`) | The employer's aggregate view, with 12 of 20 skills suppressed below k. |
| **Audit log** (`/audit`) | Every inference and disclosure, appended as it happens. |

## Evals

```
$ npm run eval

Detection
  precision                      100.0%       15/15 claimed skills correct
  recall                         100.0%       15/15 gold skills found
Calibration
  exact level match              93.3%        14/15
  within one level               100.0%       15/15
Grounding
  raw claims from model          42           merged into 15 skills
  rejected by validator          3            unknown_skill=1 unknown_artifact=1 quote_not_found=1
  ungrounded survivors           0            none

PASS — all gates met
```

Three axes, because they fail independently: **detection** (did we find the skills a
human found), **calibration** (did we get the level right), **grounding** (did we
invent anything, and did the validator stop it). Grounding is a hard gate — one
ungrounded claim reaching a profile fails the run. Gold labels are hand-written in
`data/gold/extraction.json`, independently of the recording, which is why calibration
is 93% and not a suspicious 100%.

The clock is pinned in the eval: confidence decays with artifact age, so a wall-clock
date would make the thin/not-thin boundary drift and the suite flake months from now.

## Design decisions worth arguing about

- **Confidence is derived, not asserted.** Models are bad at self-reported
  confidence. `src/lib/extract/confidence.ts` computes it from evidence volume,
  artifact-kind weight, source independence and recency, then caps it at 0.95 —
  nothing inferred from text is certain.
- **A written review outweighs a commit message** (1.0 vs 0.45). Weighting them
  equally is how you rate someone "advanced at Kubernetes" because they once bumped a
  replica count. The demo contains exactly that commit, and the pipeline correctly
  returns *beginner, thin evidence*.
- **The evidence ceiling overrides the model.** However confident the extractor is,
  one commit cannot support an "advanced" claim. `capLevel()` enforces it.
- **Partial credit in role matching.** One level short of an advanced requirement is
  genuinely closer than never having touched the skill; a binary met/unmet score
  hides exactly the information a career product exists to surface.
- **Batching is a correctness knob, not just a cost one.** Long contexts encourage
  misattributing quotes to the wrong artifact id. The validator catches those, but
  catching fewer is better than catching more.
- **Extraction is sequential, not fanned out.** A rate-limit failure halfway through a
  parallel fan-out yields a silently partial profile, which is worse than a slower
  complete one.

## Honest limits

- **One live corpus.** Only Maya Reyes has artifacts. The seven colleagues in the org
  view are seeded profiles (`data/peer-profiles.json`), there to make k-anonymity
  suppression real rather than decorative. They are not extracted.
- **Fixtures are synthetic.** Written to be realistic and to contain the specific hard
  cases (the Kafka RFC, the replica-count commit), not sampled from a real company.
- **File-backed persistence.** Seed data is read-only JSON; derived state is written
  under `.data/`. Everything goes through `src/lib/repo.ts`, so Postgres is a one-file
  swap — see `ARCHITECTURE.md`.
- **No auth.** The visibility split is modelled and enforced in the aggregation layer,
  but there is no login; "employee view" and "employer view" are just routes.
- **Level calibration is the weakest axis.** 93% exact agreement on 15 skills is a
  small sample. Real deployment needs a few hundred labelled profiles and per-skill
  rubrics, not one taxonomy-wide prompt.

## What I would build next, in order

1. **Real connectors** — GitHub, Jira, Google Docs — with incremental extraction, so
   the profile updates continuously instead of on a button press.
2. **Per-skill rubrics.** One prompt defining "advanced" across twenty skills is the
   main source of calibration error. Advanced at SQL and advanced at mentoring are not
   the same evidentiary bar.
3. **Employee-facing correction.** Let people dispute a claim, and treat disputes as
   training signal. It is also the only version of this that survives a GDPR Article
   22 conversation about automated decision-making.
4. **Manager-side demand signal.** Today roles are static JSON. The interesting graph
   is bidirectional: which skills the company is short of, weighted by what it is
   actually trying to build next quarter.

---

## Interface

Designed as a case file rather than a dashboard, because that is what it is: assertions
about a person, each carrying a citation, some deliberately withheld.

- **Stable exhibit numbers.** Every artifact gets a fixed `E-nn` assigned chronologically
  once (`src/lib/exhibits.ts`), so a citation reads the same on every screen.
- **Levels are ordinal steppers, not coloured badges.** Levels are ranked; a badge throws
  away the ordering that is the whole value.
- **Redaction is drawn, not described.** Suppressed aggregates render as actual blackout
  bars in the column where the number would be — the k-anonymity rule made visible.
- Colour is reserved for meaning: amber for thin evidence, crimson for rejection,
  verdigris for a completed action. Nothing is coloured for decoration.

Stack: Next.js 16 (App Router, server components, server actions), TypeScript strict,
zero runtime dependencies beyond React and Next. No component library, no state library,
no CSS framework — five routes and one stylesheet. Fonts load by `<link>` rather than
`next/font` so the project still builds and degrades gracefully without network access.
