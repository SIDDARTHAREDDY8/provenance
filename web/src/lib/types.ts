/**
 * Domain types for an agentic verified-hiring runtime.
 *
 * The spine of the model is the distinction between a CLAIM and EVIDENCE.
 * A résumé is a set of unverified assertions. An evidence pack is a set of
 * artifacts. A Verdict is the adjudicated relationship between the two, and it
 * cannot exist without citations that point at real spans in real documents.
 */

/* ---------------------------------------------------------------- people --- */

export interface Candidate {
  id: string;
  name: string;
  headline: string;
  location: string;
  /** Claims the candidate has asked not to be used in aggregate reporting. */
  privateSkillIds: string[];
}

/* -------------------------------------------------------------- evidence --- */

export type EvidenceKind =
  | "pull_request"
  | "commit"
  | "ticket"
  | "document"
  | "reference"
  | "certificate";

export interface EvidenceDoc {
  id: string;
  candidateId: string;
  kind: EvidenceKind;
  /** Repository, board, issuing body or referee — where this came from. */
  source: string;
  title: string;
  body: string;
  occurredAt: string;
  url?: string;
  /** Reference attestations and certificates are third-party; the rest are self-supplied. */
  attested: boolean;
}

/* ---------------------------------------------------------------- claims --- */

export type ClaimCategory = "employment" | "skill" | "achievement" | "credential" | "scope";

export interface ResumeClaim {
  id: string;
  candidateId: string;
  /** The assertion, as written by the candidate. */
  text: string;
  category: ClaimCategory;
  /** Résumé section it was lifted from, for display. */
  section: string;
  /** Taxonomy skill this claim asserts, where it asserts one. */
  skillId?: string;
  /** Level the claim asserts, if any. Verification may lower it. */
  assertedLevel?: SkillLevel;
}

/* -------------------------------------------------------------- verdicts --- */

export type VerdictStatus =
  | "verified"
  | "partially_verified"
  | "unsupported"
  | "contradicted";

export interface Citation {
  docId: string;
  /** Must appear verbatim in the document. Enforced, not hoped for. */
  quote: string;
  /** Retrieval score that surfaced this document, kept for trace inspection. */
  retrievalScore?: number;
}

export interface Verdict {
  claimId: string;
  status: VerdictStatus;
  /** 0..1, derived from citation weight and independence — never self-reported. */
  confidence: number;
  citations: Citation[];
  /** One sentence, shown to the candidate. Adverse verdicts must be explainable. */
  rationale: string;
  /** Level the evidence actually supports, which may be below the asserted level. */
  supportedLevel?: SkillLevel;
  /** Set when a human reviewer has overridden the agent. */
  overriddenBy?: string;
}

/* ----------------------------------------------------------------- roles --- */

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
  aliases: string[];
}

export interface RoleRequirement {
  skillId: string;
  minLevel: SkillLevel;
  weight: number;
  /** A requirement that cannot be traded off against strength elsewhere. */
  mustHave?: boolean;
}

export interface Role {
  id: string;
  title: string;
  team: string;
  level: number;
  requirements: RoleRequirement[];
}

/* --------------------------------------------------------------- matching -- */

export interface Contribution {
  skillId: string;
  weight: number;
  /** Level the résumé asserts. */
  claimed: SkillLevel;
  /** Level the evidence supports. */
  verified: SkillLevel;
  claimedCredit: number;
  verifiedCredit: number;
}

export interface MatchResult {
  roleId: string;
  candidateId: string;
  /** Score if you believe the résumé. What an ATS would compute. */
  claimedScore: number;
  /** Score using only what the evidence supports. The number that matters. */
  verifiedScore: number;
  contributions: Contribution[];
  /** Must-have requirements with no supporting evidence. */
  blockers: string[];
}

/* ------------------------------------------------------------- decisions --- */

export type DecisionOutcome = "advance" | "hold" | "reject";

export interface Decision {
  applicationId: string;
  outcome: DecisionOutcome;
  rationale: string;
  /** Adverse outcomes require a named human before they can leave the system. */
  requiresHumanSignoff: boolean;
  signedOffBy?: string;
  signedOffAt?: string;
  /** Factors disclosed to the candidate on an adverse outcome. */
  adverseFactors: string[];
}

export interface Application {
  id: string;
  candidateId: string;
  roleId: string;
  submittedAt: string;
}

/* ------------------------------------------------------- agent execution --- */

export type StepStatus = "pending" | "running" | "ok" | "failed" | "skipped";

export interface TraceStep {
  id: string;
  /** Agent name, e.g. "corroborate". */
  agent: string;
  label: string;
  status: StepStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  latencyMs?: number;
  /** Model calls made by this step, if any. */
  modelCalls: number;
  /** Quality gates the step ran on its own output. */
  checks: StepCheck[];
  input?: string;
  output?: string;
  error?: string;
}

export interface StepCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface AgentRun {
  id: string;
  applicationId: string;
  status: "running" | "complete" | "failed";
  startedAt: string;
  finishedAt?: string;
  steps: TraceStep[];
  provider: string;
  model: string;
  totalModelCalls: number;
}

/* ----------------------------------------------------------- corrections --- */

export interface Override {
  id: string;
  at: string;
  reviewer: string;
  applicationId: string;
  targetType: "verdict" | "decision";
  targetId: string;
  before: string;
  after: string;
  rationale: string;
  /** Promoted into the eval set so the same mistake is measured next run. */
  promotedToEval: boolean;
}

/* ---------------------------------------------------------------- audit ---- */

export type AuditEventKind =
  | "run_started"
  | "run_completed"
  | "claim_rejected"
  | "verdict_issued"
  | "override_recorded"
  | "aggregate_served"
  | "decision_recorded"
  | "signoff_required";

export interface AuditEntry {
  id: string;
  at: string;
  kind: AuditEventKind;
  actor: string;
  subjectId?: string;
  summary: string;
  detail?: Record<string, unknown>;
}
