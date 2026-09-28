/**
 * Domain types.
 *
 * Design note: a SkillClaim cannot exist without Evidence, and Evidence cannot
 * exist without an artifact id plus a quote that appears verbatim in that
 * artifact. The type system makes an ungrounded claim awkward to construct; the
 * validator in lib/extract/validate.ts makes it impossible to persist.
 */

export type ArtifactKind = "commit" | "pull_request" | "ticket" | "document" | "review";

export interface Artifact {
  id: string;
  personId: string;
  kind: ArtifactKind;
  /** Repo, board or space the artifact came from. */
  source: string;
  title: string;
  body: string;
  occurredAt: string;
  url?: string;
}

/** Ordered. Index is the numeric level used in gap arithmetic. */
export const SKILL_LEVELS = ["none", "beginner", "intermediate", "advanced", "expert"] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export function levelValue(level: SkillLevel): number {
  return SKILL_LEVELS.indexOf(level);
}

export function levelFromValue(value: number): SkillLevel {
  const clamped = Math.max(0, Math.min(SKILL_LEVELS.length - 1, Math.round(value)));
  return SKILL_LEVELS[clamped] ?? "none";
}

export type SkillDimension = "technical" | "domain" | "delivery" | "leadership";

export interface Skill {
  id: string;
  label: string;
  dimension: SkillDimension;
  /** Surface forms an extractor might emit, used to canonicalise. */
  aliases: string[];
}

/** A pointer into a specific artifact, with the exact span that justifies a claim. */
export interface Evidence {
  artifactId: string;
  /** Must appear verbatim in the artifact's title or body. Enforced, not hoped for. */
  quote: string;
}

export interface SkillClaim {
  skillId: string;
  level: SkillLevel;
  /** 0..1. Derived from evidence volume and independence, not asserted by the model. */
  confidence: number;
  evidence: Evidence[];
  /** Set when evidence is technically valid but too thin to act on. */
  thin: boolean;
}

export interface SkillProfile {
  personId: string;
  claims: SkillClaim[];
  generatedAt: string;
  provider: string;
  model: string;
  /** Claims the validator threw away, retained so the UI can show what was rejected. */
  rejected: RejectedClaim[];
  /** Raw claims emitted across all batches, before canonicalisation and merging. */
  rawClaimCount: number;
}

export interface RejectedClaim {
  skillLabel: string;
  reason: "unknown_skill" | "quote_not_found" | "no_evidence" | "unknown_artifact";
  detail: string;
}

export interface Person {
  id: string;
  name: string;
  title: string;
  team: string;
  /** Anything the employee has chosen not to expose to aggregate views. */
  privateSkillIds: string[];
}

export interface RoleRequirement {
  skillId: string;
  minLevel: SkillLevel;
  /** Relative importance within the role, 1..3. */
  weight: number;
}

export interface Role {
  id: string;
  title: string;
  track: "individual_contributor" | "management";
  level: number;
  requirements: RoleRequirement[];
}

export type OpeningKind = "requisition" | "project" | "ticket" | "mentor_pairing";

export interface Opening {
  id: string;
  kind: OpeningKind;
  roleId?: string;
  title: string;
  team: string;
  /** Skills this opening would actually build, i.e. why it closes a gap. */
  buildsSkillIds: string[];
  availableFrom: string;
  /** Present for mentor pairings. */
  personId?: string;
}

export interface Gap {
  skillId: string;
  required: SkillLevel;
  current: SkillLevel;
  /** Positive integer number of levels missing. */
  distance: number;
  weight: number;
  /** True when we have no evidence at all, as opposed to insufficient evidence. */
  unevidenced: boolean;
}

export interface Match {
  roleId: string;
  /** 0..1 weighted coverage of the role's requirements. */
  score: number;
  met: { skillId: string; level: SkillLevel }[];
  gaps: Gap[];
  /** Sum of weighted level distance. Lower is a shorter stretch. */
  stretch: number;
}

export type ActionKind =
  | "request_work"
  | "flag_interest"
  | "request_mentor"
  | "close_evidence_gap";

export interface MentorAction {
  id: string;
  kind: ActionKind;
  label: string;
  /** The real object in the system this action operates on. No free-floating advice. */
  boundTo: { type: "opening" | "role" | "person" | "skill"; id: string };
  /** The gap that produced this action. Every action is traceable to a measured gap. */
  because: { skillId: string; fromLevel: SkillLevel; toLevel: SkillLevel; roleId?: string };
  /** Ranked by expected gap closure per unit of effort. */
  priority: number;
}

export type AuditEventKind =
  | "extraction_run"
  | "claim_rejected"
  | "profile_viewed"
  | "aggregate_served"
  | "aggregate_suppressed"
  | "action_taken";

export interface AuditEntry {
  id: string;
  at: string;
  kind: AuditEventKind;
  actor: string;
  subjectPersonId?: string;
  summary: string;
  detail?: Record<string, unknown>;
}
