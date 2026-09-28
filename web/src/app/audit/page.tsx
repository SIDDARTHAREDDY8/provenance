import { SectionHead, Tag } from "@/components/ui";
import { store } from "@/lib/store";
import type { AuditEventKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const TONE: Record<AuditEventKind, "caution" | "reject" | "good" | "info" | undefined> = {
  run_started: "info",
  run_completed: "good",
  claim_rejected: "reject",
  verdict_issued: undefined,
  override_recorded: "info",
  aggregate_served: undefined,
  decision_recorded: "caution",
  signoff_required: "caution",
};

const LABEL: Record<AuditEventKind, string> = {
  run_started: "Run started",
  run_completed: "Run complete",
  claim_rejected: "Citation rejected",
  verdict_issued: "Verdict",
  override_recorded: "Override",
  aggregate_served: "Disclosure",
  decision_recorded: "Decision",
  signoff_required: "Signoff required",
};

export default async function AuditPage() {
  const db = store();
  const entries = await db.audit();

  return (
    <>
      <header>
        <p className="eyebrow">Record keeping</p>
        <h1 className="title mt-2.5 max-w-[20ch]">Every inference, every disclosure.</h1>
        <p className="standfirst mt-3">
          Written where it happens, not by a wrapper that can be bypassed. The EU AI Act places
          employment systems in the high-risk category, which carries record-keeping and
          human-oversight obligations.{" "}
          <strong>Logging at the point of inference is cheap;</strong> reconstructing six months
          later who saw what, and which model produced it, is not possible at all.
        </p>
      </header>

      {entries.length === 0 ? (
        <div className="panel mt-7" data-tone="note">
          <h3>Log is empty</h3>
          <p>Run an assessment and entries appear here.</p>
        </div>
      ) : (
        <>
          <SectionHead title="Chain of events" count={`${entries.length} entries · store: ${db.driver}`} />
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 92 }}>Time</th>
                <th style={{ width: 150 }}>Event</th>
                <th style={{ width: 150 }}>Actor</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap font-mono text-[11px] text-ink-3">
                    {new Date(e.at).toLocaleTimeString("en-GB")}
                  </td>
                  <td>
                    <Tag tone={TONE[e.kind]}>{LABEL[e.kind] ?? e.kind}</Tag>
                  </td>
                  <td className="text-[12.5px] text-ink-2">{e.actor}</td>
                  <td className="text-[12.5px]">{e.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
