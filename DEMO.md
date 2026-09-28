# Demo script — 90 seconds

Record at 1280×800 or wider. Start on `/` with `.data/` deleted so the profile is
unextracted. Speak plainly; do not read the UI aloud.

---

**0:00 — The premise** *(on `/`, before clicking)*

> Every talent tool asks people to rate their own skills. That data is stale, inflated
> and inconsistent, and then AI gets built on top of it. This reads the work instead —
> twenty-two artifacts this engineer produced doing her job.

**0:12 — Click "Run extraction"**

> Forty-two raw claims from the model, merged into fifteen skills.

**0:20 — Point at the rejection panel**

> Three did not survive. One skill wasn't in the taxonomy. One cited an artifact that
> doesn't exist. And one quoted a sentence that was never written — the model claimed
> Kafka experience and fabricated the evidence for it. Every quote is string-matched
> against its source, so fabrication is mechanically detectable, and rejections are
> shown rather than silently dropped.

**0:38 — Scroll to Kubernetes**

> Every claim cites the sentence that proved it. This one is beginner, thin evidence —
> the only thing in the corpus is a commit bumping a replica count. A tool that weights
> a commit like a written performance review calls that "advanced Kubernetes".

**0:50 — `/paths`**

> Scored against real roles. She's already meeting the senior bar. Staff Data Platform
> is 65% — and the gap is stream processing, which she genuinely does not have.

**1:02 — `/mentor`**

> This is where most products say "develop your stream processing skills". Instead:
> ticket ENG-1204, open on the Data Platform team, which builds exactly that skill.
> Bound to a real object, traceable to the measured gap. If nothing in the company
> would close a gap, nothing is offered for it.

**1:18 — `/org`**

> The employer view. Counts, never individuals — and anything under five people is
> redacted. Stream processing is hidden here, which is exactly the number a VP would
> most want. That's deliberate: the moment engineers believe the tool reports on them
> individually, they stop writing anything legible, and the data the employer is paying
> for dries up.

**1:30 — End on `/audit`** *(no narration, or one line)*

> Every inference logged at the point it happens. Under the EU AI Act this category is
> high-risk, so that's not optional.

---

## If you get 30 seconds instead

Run extraction → rejection panel → ENG-1204 on `/mentor` → the redacted org register.
Those four beats carry the whole argument.

## Questions to expect, and the short answers

**"Did you generate the data?"** Yes, and I'd say so unprompted. It's synthetic and
written to contain the hard cases deliberately — the Kafka RFC, the replica-count
commit. The pipeline and the gates are real; the corpus is a fixture.

**"What happens without the recording?"** Set `ANTHROPIC_API_KEY` and it runs live
against the same prompt. Everything after the model call is identical code.

**"How do you know it works?"** `npm run eval` — detection, calibration and grounding
scored separately, with grounding as a hard gate. One ungrounded claim fails the run.

**"Why no chat interface?"** Because advice you can't act on has a two-week half-life.
That's a product argument, and I'd rather defend it than hide it.
