import { RailNav } from "./RailNav";
import type { Artifact, ArtifactKind, Person, SkillProfile } from "@/lib/types";

const KIND_ORDER: ArtifactKind[] = ["pull_request", "ticket", "document", "commit", "review"];
const KIND_LABEL: Record<ArtifactKind, string> = {
  pull_request: "Pull requests",
  ticket: "Tickets",
  document: "Documents",
  commit: "Commits",
  review: "Written reviews",
};

export function Rail({
  person,
  artifacts,
  profile,
}: {
  person: Person | undefined;
  artifacts: Artifact[];
  profile: SkillProfile | null;
}) {
  const counts = KIND_ORDER.map((kind) => ({
    kind,
    n: artifacts.filter((a) => a.kind === kind).length,
  })).filter((c) => c.n > 0);

  const first = artifacts[0]?.occurredAt;
  const last = artifacts[artifacts.length - 1]?.occurredAt;
  const span =
    first && last
      ? `${new Date(first).toLocaleDateString("en-GB", { month: "short", year: "numeric" })} – ${new Date(
          last,
        ).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`
      : "—";

  return (
    <aside className="rail">
      <RailNav />

      <div className="rail-block">
        <p className="rail-label">Subject</p>
        <div className="rail-figure">
          <span>{person?.name ?? "—"}</span>
        </div>
        <div className="rail-figure">
          <span>{person?.title}</span>
          <b>{person?.team}</b>
        </div>
      </div>

      <div className="rail-block">
        <p className="rail-label">Corpus</p>
        <div className="corpus" aria-hidden="true">
          {counts.map((c) => (
            <i key={c.kind} style={{ width: `${(c.n / artifacts.length) * 100}%` }} />
          ))}
        </div>
        {counts.map((c) => (
          <div className="rail-figure" key={c.kind}>
            <span>{KIND_LABEL[c.kind]}</span>
            <b>{c.n}</b>
          </div>
        ))}
        <div className="rail-figure">
          <span>Period</span>
          <b>{span}</b>
        </div>
      </div>

      <div className="rail-block">
        <p className="rail-label">Extraction</p>
        {profile ? (
          <>
            <div className="rail-figure">
              <span>Raw claims</span>
              <b>{profile.rawClaimCount}</b>
            </div>
            <div className="rail-figure">
              <span>Merged skills</span>
              <b>{profile.claims.length}</b>
            </div>
            <div className="rail-figure">
              <span>Rejected</span>
              <b>{profile.rejected.length}</b>
            </div>
            <p className="rail-label" style={{ marginTop: 12, textTransform: "none", letterSpacing: 0 }}>
              {profile.model}
            </p>
          </>
        ) : (
          <div className="rail-figure">
            <span>Not yet run</span>
          </div>
        )}
      </div>
    </aside>
  );
}
