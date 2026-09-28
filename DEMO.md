# Demo script — 2 minutes

Record at 1280×800 or wider, light mode. Start with `web/.data/` deleted so
Maya's applications are unassessed. Speak plainly; do not read the UI aloud.

---

**0:00 — The queue**

> Five applications. Two numbers on each: what the résumé claims, and what the
> evidence supports. An applicant tracking system computes the first and calls it
> a match. Look at Devika — 95% claimed, 54% verified. Forty-one points of that
> résumé don't survive its own evidence.

**0:15 — Click Assess on Maya Reyes / Staff Engineer, Data Platform**

> That's queued, not run inline — one model call per claim is too slow to hold an
> HTTP connection open for.

**0:25 — The assessment lands**

> 60% claimed, 35% verified. Rejected, and held for a human.

**0:35 — The signoff panel**

> The decision is a fixed rule in code, not a model — and it still isn't final.
> An adverse outcome needs a named person, and these are the factors that would
> be disclosed to the candidate. That's the EU AI Act's human-oversight
> requirement, and it's the line Mobley v. Workday is being argued over.

**0:50 — Scroll to "Led a team of 8 engineers"**

> Contradicted. Not by an opinion — by her own referee, who says she had no
> direct reports and that three engineers was her largest span. Every verdict
> cites the sentence that decided it.

**1:05 — Scroll to the Kafka claim**

> "Expert-level production experience with Kafka." Contradicted twice: by a
> referee, and by her own RFC where she writes that she has no production
> streaming experience. A tool scoring keyword proximity credits her for this.

**1:15 — Point at "Owned the backend hiring loop"**

> This one is *unsupported*, not contradicted, and the difference matters.
> Nothing in the pack speaks to hiring either way. Treating "we have no evidence"
> as "you lied" is how a verification product becomes a defamation product.
>
> And the model tried to fabricate a quote to support it. Scroll down — it's in
> the rejected-citations panel. Every quote is string-matched against the
> document it names, so it never became proof.

**1:35 — Open the trace**

> Four steps. Each one reports the gates it ran on its own output. Two call a
> model; scoring and the decision are deterministic code.

**1:45 — Correct a verdict, then /compliance**

> Any reviewer can disagree. The change, the reason and the reviewer go into the
> eval set — a disagreement you never measure again is one you'll repeat.
>
> And the adverse-impact monitor: selection rates against the four-fifths rule,
> Group C flagged, Group D withheld because reporting three people identifies
> them.

---

## 30-second version

Queue → Assess → the 60/35 split → the contradicted Kafka claim with its citation
→ the redacted compliance table. Those five beats carry the argument.

## Questions to expect

**"Is this real model output?"** No, and I'd say so before being asked. The
fixtures are authored, labelled as authored in the code, and include a deliberate
fabrication so the citation gate runs every time. `ANTHROPIC_API_KEY` runs the
same pipeline live.

**"Did you generate the data?"** Yes. Synthetic, written to contain the specific
hard cases — the contradicting referee, the self-deprecating RFC, the claim with
no evidence in either direction. The pipeline and the gates are real; the corpus
is a fixture.

**"How do you know it works?"** Two suites. `npm run eval` gates verification —
adverse precision above recall, and one surviving fabricated citation fails the
run. `npm run ml:eval` gates the models and asserts the Python and TypeScript
feature extractors agree, feature for feature.

**"Why ML when you have an LLM?"** Different question. The classifier triages
which claims are likely to fail *before* spending a model call on each. Twelve
features and a dot product. It orders work; it never touches a verdict.

**"Why is the decision not a model?"** Because it has to be reproducible and
attributable. That's the whole compliance argument, and it's also just easier to
test.
