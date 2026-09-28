import type { Citation, EvidenceDoc, Skill } from "@/lib/types";

/**
 * Whitespace- and case-insensitive containment.
 *
 * Strict character equality sounds more rigorous but rejects good citations
 * that were re-wrapped out of a multi-line body, teaching us nothing. Normalised
 * containment still makes a fabricated quote impossible to sneak through: the
 * words must be present, and in order.
 */
export function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Below this, a quote matches by accident and proves nothing about provenance. */
export const MIN_QUOTE_CHARS = 20;

export function quoteAppearsIn(quote: string, doc: EvidenceDoc): boolean {
  return normalise(`${doc.title}\n${doc.body}`).includes(normalise(quote));
}

export interface CitationCheck {
  valid: Citation[];
  rejected: { citation: Citation; reason: "unknown_document" | "quote_not_found" | "too_short" }[];
}

/** The gate. Nothing reaches a verdict that cannot be traced to a real span. */
export function checkCitations(
  citations: Citation[],
  docsById: Map<string, EvidenceDoc>,
): CitationCheck {
  const valid: Citation[] = [];
  const rejected: CitationCheck["rejected"] = [];

  for (const citation of citations ?? []) {
    const doc = docsById.get(citation.docId);
    if (!doc) {
      rejected.push({ citation, reason: "unknown_document" });
      continue;
    }
    if (citation.quote.trim().length < MIN_QUOTE_CHARS) {
      rejected.push({ citation, reason: "too_short" });
      continue;
    }
    if (!quoteAppearsIn(citation.quote, doc)) {
      rejected.push({ citation, reason: "quote_not_found" });
      continue;
    }
    valid.push({ ...citation, quote: citation.quote.trim() });
  }

  return { valid, rejected };
}

/**
 * Evidence weight by document kind.
 *
 * A reference attestation and a certificate are third-party statements; a commit
 * message is a side effect of doing the work and is often one line. Weighting
 * them equally is how a candidate ends up "verified expert" on the strength of
 * having once bumped a config value.
 */
const KIND_WEIGHT: Record<EvidenceDoc["kind"], number> = {
  reference: 1.0,
  certificate: 0.95,
  document: 0.85,
  pull_request: 0.8,
  ticket: 0.7,
  commit: 0.45,
};

export const CONFIDENCE_CEILING = 0.95;

/** Derived from the evidence, never self-reported by the model. */
export function citationConfidence(
  citations: Citation[],
  docsById: Map<string, EvidenceDoc>,
): number {
  const docs = [...new Set(citations.map((c) => c.docId))]
    .map((id) => docsById.get(id))
    .filter((d): d is EvidenceDoc => d !== undefined);
  if (docs.length === 0) return 0;

  const weight = docs.reduce((sum, d) => sum + KIND_WEIGHT[d.kind], 0);
  // Saturating: the fourth corroborating document adds far less than the second.
  const base = 1 - Math.exp(-0.8 * weight);
  const independence = new Set(docs.map((d) => d.source)).size >= 2 ? 0.07 : 0;
  const attested = docs.some((d) => d.attested) ? 0.05 : 0;
  return Number(Math.min(CONFIDENCE_CEILING, base + independence + attested).toFixed(2));
}

export function buildSkillLookup(skills: Skill[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const skill of skills) {
    lookup.set(normalise(skill.id), skill.id);
    lookup.set(normalise(skill.label), skill.id);
    for (const alias of skill.aliases) lookup.set(normalise(alias), skill.id);
  }
  return lookup;
}

export function canonicaliseSkill(raw: string | undefined, lookup: Map<string, string>): string | undefined {
  if (!raw) return undefined;
  return lookup.get(normalise(raw));
}
