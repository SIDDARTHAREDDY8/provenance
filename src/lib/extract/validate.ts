import type { Artifact, RejectedClaim, Skill } from "@/lib/types";
import type { RawClaim } from "@/lib/llm";

/**
 * Whitespace-insensitive, case-insensitive containment.
 *
 * Strict character equality sounds more rigorous but fails on harmless
 * re-wrapping of a quote pulled out of a multi-line body, which would reject
 * good claims and teach us nothing. Normalising whitespace and case still makes
 * a fabricated quote impossible to sneak through, because the words themselves
 * must be present and in order.
 */
export function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Quotes shorter than this match by accident. "the pipeline" appears in half the
 * corpus and proves nothing about provenance.
 */
export const MIN_QUOTE_CHARS = 20;

export function quoteAppearsIn(quote: string, artifact: Artifact): boolean {
  const haystack = normalise(`${artifact.title}\n${artifact.body}`);
  return haystack.includes(normalise(quote));
}

export interface SkillIndex {
  byId: Map<string, Skill>;
  lookup: Map<string, string>;
}

export function buildSkillIndex(skills: Skill[]): SkillIndex {
  const byId = new Map<string, Skill>();
  const lookup = new Map<string, string>();
  for (const skill of skills) {
    byId.set(skill.id, skill);
    lookup.set(normalise(skill.id), skill.id);
    lookup.set(normalise(skill.label), skill.id);
    for (const alias of skill.aliases) lookup.set(normalise(alias), skill.id);
  }
  return { byId, lookup };
}

/** Maps a model's surface form onto a taxonomy id, or null if it is off-taxonomy. */
export function canonicaliseSkill(raw: string, index: SkillIndex): string | null {
  return index.lookup.get(normalise(raw)) ?? null;
}

export interface ValidatedClaim {
  skillId: string;
  level: string;
  evidence: { artifactId: string; quote: string }[];
}

export interface ValidationResult {
  accepted: ValidatedClaim[];
  rejected: RejectedClaim[];
}

/**
 * The gate. Anything that cannot be traced back to a real span in a real
 * artifact does not enter the profile — it goes on the rejected list, which the
 * UI shows, because a silently dropped hallucination teaches the operator
 * nothing about how much to trust the rest.
 */
export function validateClaims(
  raw: RawClaim[],
  artifacts: Artifact[],
  index: SkillIndex,
): ValidationResult {
  const byArtifactId = new Map(artifacts.map((a) => [a.id, a]));
  const accepted: ValidatedClaim[] = [];
  const rejected: RejectedClaim[] = [];

  for (const claim of raw) {
    const skillId = canonicaliseSkill(claim.skill, index);
    if (!skillId) {
      rejected.push({
        skillLabel: claim.skill,
        reason: "unknown_skill",
        detail: `"${claim.skill}" is not in the taxonomy and was not aliasable to anything in it.`,
      });
      continue;
    }

    const evidence: { artifactId: string; quote: string }[] = [];
    // Collect reasons locally: a claim whose every quote was fabricated should be
    // reported once, as fabrication, not also as "no evidence" afterwards.
    const reasons: RejectedClaim[] = [];
    for (const ev of claim.evidence ?? []) {
      const artifact = byArtifactId.get(ev.artifactId);
      if (!artifact) {
        reasons.push({
          skillLabel: claim.skill,
          reason: "unknown_artifact",
          detail: `Cited artifact ${ev.artifactId}, which is not in the corpus.`,
        });
        continue;
      }
      if (ev.quote.trim().length < MIN_QUOTE_CHARS) continue;
      if (!quoteAppearsIn(ev.quote, artifact)) {
        reasons.push({
          skillLabel: claim.skill,
          reason: "quote_not_found",
          detail: `Quote attributed to ${ev.artifactId} does not appear in it: "${ev.quote.slice(0, 120)}"`,
        });
        continue;
      }
      evidence.push({ artifactId: ev.artifactId, quote: ev.quote.trim() });
    }

    if (evidence.length === 0) {
      rejected.push(
        reasons[0] ?? {
          skillLabel: claim.skill,
          reason: "no_evidence",
          detail: "Claim arrived with no usable evidence attached.",
        },
      );
      continue;
    }

    // Partially grounded: keep the claim, but surface the bad citations too.
    rejected.push(...reasons);
    accepted.push({ skillId, level: claim.level, evidence });
  }

  return { accepted, rejected };
}
