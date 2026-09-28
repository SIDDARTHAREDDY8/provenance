import type { Artifact, Evidence, SkillLevel } from "@/lib/types";
import { SKILL_LEVELS, levelValue } from "@/lib/types";
import type { ExhibitMap } from "@/lib/exhibits";

/**
 * Level as an ordinal stepper. Levels are ranked, so they are drawn as filled
 * steps on a fixed track — a coloured badge would throw away the ordering that
 * is the whole point of the value.
 */
export function Level({ level, thin = false }: { level: SkillLevel; thin?: boolean }) {
  const filled = levelValue(level);
  return (
    <span className="level" data-level={level} data-thin={thin}>
      <span className="level-track" aria-hidden="true">
        {SKILL_LEVELS.slice(1).map((_, i) => (
          <i key={i} data-on={i < filled} />
        ))}
      </span>
      <span className="level-name">{level}</span>
    </span>
  );
}

export function Tag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "caution" | "reject" | "good" | "info";
}) {
  return (
    <span className="tag" data-tone={tone}>
      {children}
    </span>
  );
}

const KIND_LABEL: Record<Artifact["kind"], string> = {
  commit: "Commit",
  pull_request: "Pull request",
  ticket: "Ticket",
  document: "Document",
  review: "Written review",
};

/**
 * A claim's evidence, set as citations: exhibit number in the margin, the quoted
 * span as the primary text, provenance underneath. The quote is the thing being
 * asserted about a person, so it gets the reading face and the largest size on
 * the row.
 */
export function Citations({
  evidence,
  artifactsById,
  exhibits,
}: {
  evidence: Evidence[];
  artifactsById: Map<string, Artifact>;
  exhibits: ExhibitMap;
}) {
  return (
    <ul className="citations">
      {evidence.map((ev) => {
        const artifact = artifactsById.get(ev.artifactId);
        return (
          <li className="citation" key={`${ev.artifactId}-${ev.quote.slice(0, 16)}`}>
            <span className="exhibit">{exhibits.get(ev.artifactId) ?? "—"}</span>
            <div className="citation-body">
              <q>{ev.quote}</q>
              <p className="provenance">
                {artifact
                  ? `${KIND_LABEL[artifact.kind]} · ${artifact.source} · ${new Date(
                      artifact.occurredAt,
                    ).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
                  : ev.artifactId}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function SectionHead({ title, count }: { title: string; count?: string }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {count && <span className="count">{count}</span>}
    </div>
  );
}
