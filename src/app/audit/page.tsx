import { SectionHead, Tag } from "@/components/ui";
import { repo } from "@/lib/repo";
import type { AuditEventKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const TONE: Record<AuditEventKind, "caution" | "reject" | "good" | "info" | undefined> = {
  extraction_run: "info",
  claim_rejected: "reject",
  profile_viewed: undefined,
  aggregate_served: undefined,
  aggregate_suppressed: "caution",
  action_taken: "good",
};

const LABEL: Record<AuditEventKind, string> = {
  extraction_run: "Extraction",
  claim_rejected: "Rejection",
  profile_viewed: "Profile read",
  aggregate_served: "Disclosure",
  aggregate_suppressed: "Withheld",
  action_taken: "Action",
};

export default async function AuditPage() {
  const entries = await repo.audit();

  return (
    <>
      <header>
        <p className="eyebrow">Record keeping</p>
        <h1 className="title">Every inference, every disclosure.</h1>
        <p className="standfirst">
          Appended at the point it happens. The EU AI Act places worker-management systems in the
          high-risk category, which carries record-keeping and human-oversight obligations.{" "}
          <strong>Logging at the point of inference is cheap;</strong> reconstructing who saw what
          six months later is not possible at all.
        </p>
      </header>

      {entries.length === 0 ? (
        <div className="panel mt-lg" data-tone="note">
          <h3>Log is empty</h3>
          <p>Run an extraction or request an action and entries appear here.</p>
        </div>
      ) : (
        <>
          <SectionHead title="Chain of events" count={`${entries.length} entries`} />
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 92 }}>Time</th>
                <th style={{ width: 110 }}>Event</th>
                <th style={{ width: 132 }}>Actor</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="mono dim" style={{ whiteSpace: "nowrap" }}>
                    {new Date(e.at).toLocaleTimeString("en-GB")}
                  </td>
                  <td>
                    <Tag tone={TONE[e.kind]}>{LABEL[e.kind]}</Tag>
                  </td>
                  <td className="small dim">{e.actor}</td>
                  <td className="small">{e.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
