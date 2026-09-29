# Demo script — 2 minutes

Record at 1280×800 or wider, light mode. Reset first so the run happens on camera:

```bash
cd ~/Desktop/provenance && rm -rf web/.data && npm run dev
```

Speak plainly. Don't read the UI aloud — say the thing the UI can't.

---

**0:00 — The queue**

> Five applications, two numbers on each. What the résumé claims, and what the
> evidence pack supports. Devika at the bottom: 95% claimed, 54% verified.
> Forty-one points of that résumé don't survive contact with her own evidence.
>
> An applicant tracking system computes the first number and calls it a match.

**0:15 — Click Assess on Maya Reyes / Staff Engineer, Data Platform**

> Queued, not run inline. It's one model call per claim — too slow to hold an
> HTTP connection open for.

**0:25 — The assessment lands**

> 60% claimed, 35% verified. Rejected, held for a human.

**0:35 — The signoff panel**

> The decision is a fixed rule in code — no model is involved past the point of
> reading evidence — and it's still not final. An adverse outcome needs a named
> person, and these are the factors that would be disclosed to the candidate.
>
> That's the EU AI Act's human-oversight requirement, and it's the line Mobley
> v. Workday is being argued over: who decided, and on what.

**0:50 — Scroll to "Led a team of 8 engineers"**

> Contradicted. Not by an opinion — by her own referee, who states she had no
> direct reports and that three engineers was her largest span. Both citations
> are there, quoted.

**1:00 — The Kafka claim**

> "Expert-level production experience with Kafka." Contradicted twice: by a
> referee, and by her own RFC where she writes that she has no production
> streaming experience. A tool scoring keyword proximity gives her full marks.

**1:10 — "Owned the backend hiring loop" → unsupported**

> This one is *unsupported*, not contradicted, and the difference is the whole
> product. Nothing in the pack speaks to hiring either way. Treating "no
> evidence" as "you lied" is how a verification product becomes a defamation
> product.

**1:25 — Open the trace**

> Four steps, each reporting the gates it ran on its own output. Two call a
> model. Scoring and the decision are deterministic code.

**1:35 — The part I'd actually lead with**

> I ran this against a real model rather than fixtures, and it found two bugs in
> my own work.
>
> The model assigned a seniority level to 2 of 18 claims — correctly, because
> the résumé doesn't state one. My scoring had been depending on levels my
> fixtures invented. That's the same unfounded inference the product exists to
> catch, sitting in my own scorer.
>
> And an adverse verdict came back correct given its context and wrong given the
> full evidence pack, because the deciding document was never retrieved. So
> retrieval recall is now measured separately — "judged badly" and "never shown
> the document" look identical in an accuracy number and need opposite fixes.

**1:55 — /compliance, then stop**

> Selection rates against the four-fifths rule. Group C flagged for examination.
> Group D shows no rate at all — three people, below the reporting threshold, so
> publishing its rate would identify them.

---

## 30-second version

Queue → Assess → the 60/35 split → the contradicted Kafka claim with its
citations → the compliance table with Group D withheld. Five beats, whole argument.

## The one finding worth 20 seconds on its own

Measured on this corpus with `all-MiniLM-L6-v2`:

```
"Led a team of 8 engineers"
"She did not have direct reports at any point"     cosine  −0.02
```

The most decisive pair in the evidence pack reads as **unrelated text**, because
a contradiction is not a paraphrase. No better embedding model fixes that. So
retrieval does two different jobs: similarity search for supporting evidence,
and structural inclusion for contradicting evidence — for claims about scope,
employment or credentials, every attestation enters the context and gets read
rather than ranked.

If you only have time for one technical point, use this one. It's measurable,
it's counterintuitive, and it's the kind of thing you only learn by building.

## Questions to expect

**"Is this real model output?"** Yes. `npm run capture` ran the pipeline through
the Claude Code CLI and committed each response verbatim. It then replays from
what it wrote and fails if any verdict differs.

**"Did you generate the data?"** The corpus, yes — résumé and evidence pack are
written, not sampled from a real candidate, and the README says so. The pipeline,
the gates and the measurements are real.

**"How do you know it works?"** Two suites. `npm run eval` gates verification —
adverse precision above recall, retrieval recall scored separately, and an
adversarial probe that attacks the citation validator with a fabricated quote, a
phantom document and a real quote from outside the context. `npm run ml:eval`
gates the models and asserts the Python and TypeScript feature extractors agree
feature for feature.

**"Why 94.4% and not 100%?"** One honest disagreement on the résumé's skills
summary line: the model reads it as partially verified, I read it as verified.
It was 100% when the fixtures were mine, which is exactly why that number was
worth less.

**"Why is the decision not a model?"** Because it has to be reproducible and
attributable. That's the compliance argument, and it's also just easier to test.
