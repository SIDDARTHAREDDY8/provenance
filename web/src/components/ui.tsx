import type { Citation, EvidenceDoc, SkillLevel, VerdictStatus } from "@/lib/types";
import { SKILL_LEVELS, levelValue } from "@/lib/types";

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

const STATUS_TONE: Record<VerdictStatus, "good" | "caution" | "reject" | undefined> = {
  verified: "good",
  partially_verified: "caution",
  unsupported: undefined,
  contradicted: "reject",
};

const STATUS_LABEL: Record<VerdictStatus, string> = {
  verified: "Verified",
  partially_verified: "Overstated",
  unsupported: "Unsupported",
  contradicted: "Contradicted",
};

export function StatusTag({ status }: { status: VerdictStatus }) {
  return <Tag tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>;
}

/** Levels are ranked, so they are drawn as filled steps rather than a colour. */
export function Level({ level, muted = false }: { level: SkillLevel; muted?: boolean }) {
  const filled = levelValue(level);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {SKILL_LEVELS.slice(1).map((_, i) => (
          <i
            key={i}
            className={`block h-[3px] w-[11px] ${
              i < filled ? (muted ? "bg-amber" : "bg-prussian") : "bg-rule-strong"
            }`}
          />
        ))}
      </span>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-2">{level}</span>
    </span>
  );
}

const KIND_LABEL: Record<EvidenceDoc["kind"], string> = {
  commit: "Commit",
  pull_request: "Pull request",
  ticket: "Ticket",
  document: "Document",
  reference: "Reference",
  certificate: "Certificate",
};

export function Citations({
  citations,
  docsById,
  exhibits,
}: {
  citations: Citation[];
  docsById: Map<string, EvidenceDoc>;
  exhibits: Map<string, string>;
}) {
  if (citations.length === 0) {
    return (
      <p className="mt-3 text-[13px] text-ink-3 italic">
        No citation. Nothing in the evidence pack speaks to this claim either way.
      </p>
    );
  }
  return (
    <ul className="mt-3 grid list-none gap-2.5 p-0">
      {citations.map((c) => {
        const doc = docsById.get(c.docId);
        return (
          <li className="citation" key={`${c.docId}-${c.quote.slice(0, 14)}`}>
            <span className="exhibit">{exhibits.get(c.docId) ?? "—"}</span>
            <div className="body">
              <q>{c.quote}</q>
              <p className="provenance">
                {doc
                  ? `${KIND_LABEL[doc.kind]} · ${doc.source} · ${new Date(doc.occurredAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
                  : c.docId}
                {doc?.attested && " · third-party attested"}
                {c.retrievalScore !== undefined && ` · retrieval ${c.retrievalScore.toFixed(3)}`}
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

export function Meter({ value, tone = "prussian" }: { value: number; tone?: "prussian" | "amber" }) {
  return (
    <span className="relative block h-[3px] w-full bg-rule">
      <i
        className={`absolute inset-y-0 left-0 block ${tone === "amber" ? "bg-amber" : "bg-prussian"}`}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </span>
  );
}

export function exhibitNumbers(docs: EvidenceDoc[]): Map<string, string> {
  const ordered = [...docs].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return new Map(ordered.map((d, i) => [d.id, `E-${String(i + 1).padStart(2, "0")}`]));
}
