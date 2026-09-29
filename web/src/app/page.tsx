import Link from "next/link";
import { Meter, SectionHead, Tag } from "@/components/ui";
import { RunAssessment } from "@/components/RunAssessment";
import { reviewPriority } from "@/lib/ml/infer";
import { store } from "@/lib/store";
import { queue } from "@/lib/queue";

export const dynamic = "force-dynamic";

interface SeededRow {
  applicationId: string;
  claimedScore: number;
  verifiedScore: number;
  blockers: string[];
  contradicted: number;
  attestedRatio: number;
  distinctSources: number;
}

export default async function QueuePage() {
  const db = store();
  const [applications, candidates, roles, seeded] = await Promise.all([
    db.applications(),
    db.candidates(),
    db.roles(),
    (async () => {
      try {
        const { readFile } = await import("node:fs/promises");
        const path = await import("node:path");
        return JSON.parse(
          await readFile(path.join(process.cwd(), "data", "seeded-assessments.json"), "utf8"),
        ) as SeededRow[];
      } catch {
        return [] as SeededRow[];
      }
    })(),
  ]);

  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  const roleById = new Map(roles.map((r) => [r.id, r]));

  const rows = await Promise.all(
    applications.map(async (app) => {
      const assessed = await db.getAssessment(app.id);
      const seed = seeded.find((s) => s.applicationId === app.id);
      // Only candidates with an evidence pack can be assessed. The rest carry
      // seeded scores so the queue, the ranker and the aggregate view have a
      // population — offering a button that cannot work is worse than saying so.
      const evidenceCount = (await db.evidence(app.candidateId)).length;

      const scores = assessed
        ? {
            claimed: assessed.match.claimedScore,
            verified: assessed.match.verifiedScore,
            blockers: assessed.match.blockers.length,
            contradicted: assessed.verdicts.filter((v) => v.status === "contradicted").length,
            attested: assessed.verdicts.some((v) => v.citations.length > 0) ? 0.4 : 0,
            sources: Math.min(1, new Set(assessed.verdicts.flatMap((v) => v.citations.map((c) => c.docId))).size / 10),
            outcome: assessed.decision.outcome,
            signed: Boolean(assessed.decision.signedOffBy),
            live: true as const,
          }
        : seed
          ? {
              claimed: seed.claimedScore,
              verified: seed.verifiedScore,
              blockers: seed.blockers.length,
              contradicted: seed.contradicted,
              attested: seed.attestedRatio,
              sources: Math.min(1, seed.distinctSources / 10),
              outcome: null,
              signed: false,
              live: false as const,
            }
          : null;

      const priority = scores
        ? await reviewPriority({
            verified_score: scores.verified,
            claimed_score: scores.claimed,
            inflation: Math.max(0, scores.claimed - scores.verified),
            blockers: scores.blockers,
            contradicted: scores.contradicted,
            attested_ratio: scores.attested,
            distinct_sources_norm: scores.sources,
          })
        : null;

      return { app, scores, priority, evidenceCount };
    }),
  );

  rows.sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1));
  const unassessed = rows.filter((r) => !r.scores?.live).length;

  return (
    <>
      <header>
        <p className="eyebrow">Review queue · Engineering</p>
        <h1 className="title mt-2.5 max-w-[20ch]">Read the second number.</h1>
        <p className="standfirst mt-3">
          Every application carries two scores: what the résumé claims, and what the evidence pack
          supports. An applicant tracking system computes the first and calls it a match.{" "}
          <strong>The gap between them is the product.</strong>
        </p>
      </header>

      <SectionHead
        title="Applications"
        count={`${rows.length} total · ${unassessed} not yet assessed · ordered by review priority`}
      />

      <table className="tbl">
        <thead>
          <tr>
            <th>Candidate</th>
            <th>Role</th>
            <th className="num">Claimed</th>
            <th className="num">Verified</th>
            <th style={{ width: 118 }}>Gap</th>
            <th>Status</th>
            <th className="num">Priority</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ app, scores, priority, evidenceCount }) => {
            const candidate = candidateById.get(app.candidateId);
            const role = roleById.get(app.roleId);
            const gap = scores ? Math.max(0, scores.claimed - scores.verified) : 0;
            return (
              <tr key={app.id}>
                <td>
                  <Link href={`/applications/${app.id}`} className="font-medium no-underline text-ink hover:text-prussian">
                    {candidate?.name ?? app.candidateId}
                  </Link>
                  <div className="text-[12px] text-ink-3">{candidate?.location}</div>
                </td>
                <td className="text-ink-2">{role?.title ?? app.roleId}</td>
                <td className="num text-ink-3">{scores ? `${Math.round(scores.claimed * 100)}%` : "—"}</td>
                <td className="num font-medium">{scores ? `${Math.round(scores.verified * 100)}%` : "—"}</td>
                <td>
                  {scores ? (
                    <span className="block w-[104px]">
                      <Meter value={gap} tone="amber" />
                      <span className="mt-1 block font-mono text-[10px] text-amber">
                        −{Math.round(gap * 100)} pts
                      </span>
                    </span>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
                <td>
                  {evidenceCount === 0 ? (
                    <Tag>No evidence pack</Tag>
                  ) : !scores ? (
                    <Tag>Not assessed</Tag>
                  ) : !scores.live ? (
                    <Tag tone="info">Seeded</Tag>
                  ) : scores.outcome === "advance" ? (
                    <Tag tone="good">Advance</Tag>
                  ) : scores.signed ? (
                    <Tag tone="reject">{scores.outcome} · signed</Tag>
                  ) : (
                    <Tag tone="caution">Awaiting signoff</Tag>
                  )}
                </td>
                <td className="num text-ink-2">{priority !== null ? priority.toFixed(2) : "—"}</td>
                <td className="text-right">
                  {scores?.live ? (
                    <Link href={`/applications/${app.id}`} className="btn" data-variant="quiet">
                      Open →
                    </Link>
                  ) : evidenceCount === 0 ? (
                    <span className="text-[12px] text-ink-3">seeded score only</span>
                  ) : (
                    <RunAssessment applicationId={app.id} label="Assess" variant="default" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-7 grid gap-3 md:grid-cols-2">
        <div className="panel" data-tone="note">
          <h3>Priority is a scheduling call, not a decision</h3>
          <p>
            The order above comes from a logistic regression trained in{" "}
            <code className="font-mono text-[11px]">ml/</code> on verified fit, inflation, blockers
            and attestation density. It decides which of forty applications a human opens first.{" "}
            <strong>The adjudicator never reads it</strong> — outcomes come from a fixed rule, in
            code, reproducible.
          </p>
        </div>
        <div className="panel">
          <h3>Queue</h3>
          <p>
            Assessments run on the <code className="font-mono text-[11px]">{queue().driver}</code>{" "}
            queue with bounded retries — one model call per claim is too slow to hold an HTTP
            connection open for. Storage driver:{" "}
            <code className="font-mono text-[11px]">{db.driver}</code>.
          </p>
        </div>
      </div>
    </>
  );
}
