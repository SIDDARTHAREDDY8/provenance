import Link from "next/link";
import { notFound } from "next/navigation";
import { overrideVerdict, signOff } from "@/app/actions";
import { RunAssessment } from "@/components/RunAssessment";
import { Citations, Level, Meter, SectionHead, StatusTag, Tag, exhibitNumbers } from "@/components/ui";
import { claimRiskScores } from "@/lib/assess";
import { store } from "@/lib/store";
import type { VerdictStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const NEXT_STATUS: VerdictStatus[] = ["verified", "partially_verified", "unsupported", "contradicted"];

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = store();

  const [applications, candidates, roles, skills] = await Promise.all([
    db.applications(),
    db.candidates(),
    db.roles(),
    db.skills(),
  ]);

  const application = applications.find((a) => a.id === id);
  if (!application) notFound();

  const candidate = candidates.find((c) => c.id === application.candidateId);
  const role = roles.find((r) => r.id === application.roleId);
  const [assessment, docs, overrides] = await Promise.all([
    db.getAssessment(id),
    db.evidence(application.candidateId),
    db.overrides(id),
  ]);

  const skillLabel = new Map(skills.map((s) => [s.id, s.label]));

  if (!assessment) {
    return (
      <>
        <header>
          <p className="eyebrow">
            <Link href="/" className="no-underline">Queue</Link> · {application.id}
          </p>
          <h1 className="title mt-2.5">{candidate?.name}</h1>
          <p className="standfirst mt-3">
            {role?.title} · evidence pack of {docs.length} documents, not yet assessed.
          </p>
        </header>
        <div className="panel mt-7" data-tone="note">
          <h3>No assessment on file</h3>
          <p>
            The run indexes the evidence pack, splits the résumé into discrete claims, adjudicates
            each one against retrieved evidence, then scores and applies policy. Four steps, one
            model call per claim.
          </p>
          <div className="mt-4">
            <RunAssessment applicationId={id} />
          </div>
        </div>
      </>
    );
  }

  const { match, decision, verdicts, claims, run, fabricated } = assessment;
  const docsById = new Map(docs.map((d) => [d.id, d]));
  const exhibits = exhibitNumbers(docs);
  const risk = await claimRiskScores(assessment);
  const claimById = new Map(claims.map((c) => [c.id, c]));

  const counts = verdicts.reduce<Record<string, number>>((acc, v) => {
    acc[v.status] = (acc[v.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <header>
        <p className="eyebrow">
          <Link href="/" className="no-underline">Queue</Link> · {application.id}
        </p>
        <h1 className="title mt-2.5">{candidate?.name}</h1>
        <p className="standfirst mt-3">
          {role?.title} · {docs.length} evidence documents · {claims.length} claims ·{" "}
          {run.totalModelCalls} model calls
        </p>
      </header>

      {/* --- the number ------------------------------------------------------ */}
      <div className="mt-7 grid gap-5 rounded-[3px] border border-rule bg-sheet p-6 md:grid-cols-[1fr_1fr_1.4fr]">
        <div>
          <p className="eyebrow">Claimed fit</p>
          <p className="mt-1 font-mono text-[30px] leading-none tabular-nums text-ink-3">
            {Math.round(match.claimedScore * 100)}%
          </p>
          <div className="mt-2.5">
            <Meter value={match.claimedScore} tone="amber" />
          </div>
          <p className="mt-2 text-[12px] text-ink-3">What an ATS would have scored.</p>
        </div>
        <div>
          <p className="eyebrow">Verified fit</p>
          <p className="mt-1 font-mono text-[30px] leading-none tabular-nums">
            {Math.round(match.verifiedScore * 100)}%
          </p>
          <div className="mt-2.5">
            <Meter value={match.verifiedScore} />
          </div>
          <p className="mt-2 text-[12px] text-ink-3">
            {Math.round((match.claimedScore - match.verifiedScore) * 100)} points of the résumé did
            not survive its own evidence.
          </p>
        </div>
        <div className="border-t border-rule pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
          <p className="eyebrow">Outcome</p>
          <p className="mt-1.5 flex items-center gap-2">
            <span className="font-serif text-[21px] capitalize">{decision.outcome}</span>
            {decision.signedOffBy ? (
              <Tag tone="good">Signed off</Tag>
            ) : decision.requiresHumanSignoff ? (
              <Tag tone="caution">Held for a human</Tag>
            ) : null}
          </p>
          <p className="mt-2 text-[13px] text-ink-2">{decision.rationale}</p>
        </div>
      </div>

      {/* --- signoff --------------------------------------------------------- */}
      {decision.requiresHumanSignoff && !decision.signedOffBy && (
        <div className="panel mt-4" data-tone="caution">
          <h3>This outcome cannot leave the system unsigned</h3>
          <p>
            An adverse outcome is computed by a fixed rule, never by a model — and it is still not
            final. A named person accepts it, and that acceptance is what goes in the record. These
            are the factors that would be disclosed to the candidate:
          </p>
          <ul className="mt-3 grid list-none gap-1.5 p-0">
            {decision.adverseFactors.map((f, i) => (
              <li key={i} className="border-l-2 border-amber pl-3 text-[13px] text-ink-2">
                {f}
              </li>
            ))}
          </ul>
          <form action={signOff} className="mt-4 flex flex-wrap items-center gap-2">
            <input type="hidden" name="applicationId" value={id} />
            <input
              name="reviewer"
              placeholder="Your name"
              className="rounded-[3px] border border-rule-strong bg-paper px-2.5 py-1.5 text-[13px]"
            />
            <button className="btn" data-variant="danger" type="submit">
              Accept this outcome
            </button>
          </form>
        </div>
      )}

      {/* --- verdicts -------------------------------------------------------- */}
      <SectionHead
        title="Claims"
        count={Object.entries(counts)
          .map(([k, v]) => `${v} ${k.replace("_", " ")}`)
          .join(" · ")}
      />

      <div>
        {verdicts.map((verdict) => {
          const claim = claimById.get(verdict.claimId);
          if (!claim) return null;
          const r = risk[claim.id];
          return (
            <article key={verdict.claimId} className="border-b border-rule py-5">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-[16px] leading-snug text-ink">“{claim.text}”</p>
                  <p className="provenance">
                    {claim.section} · {claim.category}
                    {claim.skillId && ` · ${skillLabel.get(claim.skillId) ?? claim.skillId}`}
                    {r !== null && r !== undefined && ` · pre-check risk ${r.toFixed(2)}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {verdict.overriddenBy && <Tag tone="info">Human override</Tag>}
                  <StatusTag status={verdict.status} />
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                {claim.assertedLevel && (
                  <span className="flex items-center gap-2 text-[12px] text-ink-3">
                    claimed <Level level={claim.assertedLevel} muted />
                  </span>
                )}
                {verdict.supportedLevel && (
                  <span className="flex items-center gap-2 text-[12px] text-ink-3">
                    supported <Level level={verdict.supportedLevel} />
                  </span>
                )}
                {verdict.citations.length > 0 && (
                  <span className="font-mono text-[11px] text-ink-3">
                    confidence {verdict.confidence.toFixed(2)}
                  </span>
                )}
              </div>

              <p className="mt-2.5 text-[13px] text-ink-2">{verdict.rationale}</p>

              <Citations citations={verdict.citations} docsById={docsById} exhibits={exhibits} />

              <form action={overrideVerdict} className="mt-3.5 flex flex-wrap items-center gap-2">
                <input type="hidden" name="applicationId" value={id} />
                <input type="hidden" name="claimId" value={claim.id} />
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                  Disagree?
                </span>
                <select
                  name="status"
                  defaultValue={verdict.status}
                  className="rounded-[3px] border border-rule-strong bg-paper px-2 py-1 text-[12px]"
                >
                  {NEXT_STATUS.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
                <input
                  name="rationale"
                  placeholder="Why the agent is wrong"
                  className="min-w-[220px] flex-1 rounded-[3px] border border-rule-strong bg-paper px-2.5 py-1 text-[12px]"
                />
                <button className="btn" type="submit">
                  Correct
                </button>
              </form>
            </article>
          );
        })}
      </div>

      {/* --- notes ----------------------------------------------------------- */}
      <div className="mt-7 grid gap-3 md:grid-cols-2">
        {fabricated.length > 0 && (
          <div className="panel" data-tone="reject">
            <h3>
              {fabricated.length} citation{fabricated.length === 1 ? "" : "s"} rejected before scoring
            </h3>
            <p>
              The model cited evidence that does not exist. Every quote is string-matched against the
              document it names, so this was caught rather than presented as proof. The affected
              claim was downgraded, not silently kept.
            </p>
            {fabricated.map((f, i) => (
              <p key={i} className="mt-2 font-mono text-[11px] text-ink-3">
                {f.claimId} → {f.docId} · {f.reason} · “{f.quote.slice(0, 84)}…”
              </p>
            ))}
          </div>
        )}
        <div className="panel">
          <h3>How this ran</h3>
          <p>
            {run.steps.length} steps, {run.totalModelCalls} model calls, retrieval over{" "}
            {assessment.indexSize} chunks via <code className="font-mono text-[11px]">{assessment.embedder}</code>.
            Corroboration is per candidate and scoring is per role, so a second application from the
            same person costs no further model calls.
          </p>
          <p className="mt-3">
            <Link className="btn" data-variant="quiet" href={`/applications/${id}/trace`}>
              Inspect the run →
            </Link>
          </p>
        </div>
      </div>

      {overrides.length > 0 && (
        <p className="mt-4 text-[12px] text-ink-3">
          {overrides.length} human correction{overrides.length === 1 ? "" : "s"} on this application ·{" "}
          <Link href="/corrections">see the correction log</Link>
        </p>
      )}
    </>
  );
}
