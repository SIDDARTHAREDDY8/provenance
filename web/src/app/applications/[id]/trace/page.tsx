import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionHead, Tag } from "@/components/ui";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function TracePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const assessment = await store().getAssessment(id);
  if (!assessment) notFound();
  const { run, retrieval } = assessment;

  return (
    <>
      <header>
        <p className="eyebrow">
          <Link href={`/applications/${id}`} className="no-underline">
            {id}
          </Link>{" "}
          · Run {run.id}
        </p>
        <h1 className="title mt-2.5 max-w-[22ch]">What the agents actually did.</h1>
        <p className="standfirst mt-3">
          Every step reports the checks it ran on its own output.{" "}
          <strong>A log of function calls tells you what happened; a log of steps with their own
          gates tells you whether to believe the result.</strong> This is the page a reviewer opens
          when a verdict looks wrong.
        </p>
      </header>

      <SectionHead
        title="Steps"
        count={`${run.steps.length} steps · ${run.totalModelCalls} model calls · ${run.provider}/${run.model}`}
      />

      <div className="grid gap-0">
        {run.steps.map((step, i) => (
          <article key={step.id} className="grid grid-cols-[34px_minmax(0,1fr)] gap-4 border-b border-rule py-5">
            <span className="pt-0.5 font-mono text-[11px] tabular-nums text-ink-3">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[13px] font-medium">{step.agent}</span>
                <Tag tone={step.status === "ok" ? "good" : step.status === "failed" ? "reject" : "caution"}>
                  {step.status}
                </Tag>
                {step.modelCalls > 0 ? (
                  <Tag tone="info">
                    {step.modelCalls} model call{step.modelCalls === 1 ? "" : "s"}
                  </Tag>
                ) : (
                  <Tag>deterministic</Tag>
                )}
                {step.attempts > 1 && <Tag tone="caution">{step.attempts} attempts</Tag>}
                <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-3">
                  {step.latencyMs}ms
                </span>
              </div>

              <p className="mt-1 text-[13px] text-ink-2">{step.label}</p>

              <dl className="mt-3 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
                {step.input && (
                  <div className="flex gap-2">
                    <dt className="text-ink-3">in</dt>
                    <dd className="m-0 text-ink-2">{step.input}</dd>
                  </div>
                )}
                {step.output && (
                  <div className="flex gap-2">
                    <dt className="text-ink-3">out</dt>
                    <dd className="m-0 text-ink-2">{step.output}</dd>
                  </div>
                )}
              </dl>

              <ul className="mt-3 grid list-none gap-1 p-0">
                {step.checks.map((check) => (
                  <li key={check.name} className="flex items-start gap-2 text-[12.5px]">
                    <span className={check.passed ? "text-verdigris" : "text-crimson"}>
                      {check.passed ? "✓" : "✗"}
                    </span>
                    <span className="text-ink-2">
                      <span className="text-ink">{check.name}</span> — {check.detail}
                    </span>
                  </li>
                ))}
              </ul>

              {step.error && (
                <p className="mt-2 font-mono text-[11px] text-crimson">{step.error}</p>
              )}
            </div>
          </article>
        ))}
      </div>

      <SectionHead title="Retrieval" count={`${assessment.indexSize} chunks · ${assessment.embedder}`} />
      <table className="tbl">
        <thead>
          <tr>
            <th>Claim</th>
            <th>Documents retrieved, best first</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(retrieval).map(([claimId, hits]) => (
            <tr key={claimId}>
              <td className="font-mono text-[11px] text-ink-3">{claimId}</td>
              <td>
                <span className="flex flex-wrap gap-1.5">
                  {hits.length === 0 && <span className="text-ink-3 italic">nothing above threshold</span>}
                  {hits.map((h, i) => (
                    <span key={`${h.docId}-${i}`} className="tag">
                      {h.docId} <span className="text-ink-3">{h.score.toFixed(3)}</span>
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="panel mt-7" data-tone="note">
        <h3>Where the model stops</h3>
        <p>
          Two steps call a model: splitting the résumé into claims, and adjudicating each claim
          against retrieved evidence. <strong>Scoring and the decision are deterministic code.</strong>{" "}
          A ranking that decides who gets seen has to be reproducible and inspectable line by line,
          which a sampled generation is not — and the EU AI Act&rsquo;s human-oversight requirement
          for high-risk employment systems is unsatisfiable if the rule lives inside one.
        </p>
      </div>
    </>
  );
}
