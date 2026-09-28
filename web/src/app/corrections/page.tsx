import Link from "next/link";
import { SectionHead, Tag } from "@/components/ui";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function CorrectionsPage() {
  const overrides = await store().overrides();
  const promoted = overrides.filter((o) => o.promotedToEval).length;

  return (
    <>
      <header>
        <p className="eyebrow">Human corrections</p>
        <h1 className="title mt-2.5 max-w-[22ch]">Disagreement is the only training signal you get for free.</h1>
        <p className="standfirst mt-3">
          Every reviewer correction is recorded with its reason and promoted into the eval set.{" "}
          <strong>A disagreement the system never measures again is one it will repeat next
          quarter</strong> — and on an adverse verdict, repeating it costs somebody a job.
        </p>
      </header>

      {overrides.length === 0 ? (
        <div className="panel mt-7" data-tone="note">
          <h3>No corrections yet</h3>
          <p>
            Open an assessment and disagree with a verdict. The change, the reason and the reviewer
            are recorded here, and the case is added to the labelled set the next eval run scores
            against.
          </p>
          <p className="mt-3">
            <Link className="btn" data-variant="quiet" href="/">
              Back to the queue →
            </Link>
          </p>
        </div>
      ) : (
        <>
          <SectionHead
            title="Correction log"
            count={`${overrides.length} correction(s) · ${promoted} promoted to the eval set`}
          />
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 92 }}>When</th>
                <th style={{ width: 150 }}>Reviewer</th>
                <th>Target</th>
                <th>Change</th>
                <th>Reason</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {overrides.map((o) => (
                <tr key={o.id}>
                  <td className="font-mono text-[11px] text-ink-3">
                    {new Date(o.at).toLocaleTimeString("en-GB")}
                  </td>
                  <td className="text-ink-2">{o.reviewer}</td>
                  <td className="font-mono text-[11px]">
                    <Link href={`/applications/${o.applicationId}`}>{o.applicationId}</Link> ·{" "}
                    {o.targetId}
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="text-ink-3">{o.before.replace("_", " ")}</span>{" "}
                    <span className="text-ink-3">→</span>{" "}
                    <span className="font-medium">{o.after.replace("_", " ")}</span>
                  </td>
                  <td className="text-[12.5px] text-ink-2">{o.rationale}</td>
                  <td>{o.promotedToEval && <Tag tone="info">In eval set</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="panel mt-7" data-tone="note">
        <h3>The design problem this is answering</h3>
        <p>
          Showing what an agent concluded is the easy half. The hard half is letting a person
          disagree in a way the system can learn from — a correction that only edits a row is a
          correction that teaches nothing.{" "}
          <strong>Each row here carries the reason, not just the change</strong>, which is what makes
          it usable as a labelled example rather than a database edit.
        </p>
      </div>
    </>
  );
}
