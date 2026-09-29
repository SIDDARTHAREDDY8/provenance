import type {
  AgentRun,
  Application,
  AuditEntry,
  Candidate,
  Decision,
  EvidenceDoc,
  MatchResult,
  Override,
  ResumeClaim,
  Role,
  Skill,
  Verdict,
} from "@/lib/types";

export interface StoredAssessment {
  applicationId: string;
  run: AgentRun;
  claims: ResumeClaim[];
  verdicts: Verdict[];
  match: MatchResult;
  decision: Decision;
  fabricated: { claimId: string; docId: string; quote: string; reason: string }[];
  retrieval: Record<string, { docId: string; score: number }[]>;
  indexSize: number;
  embedder: string;
  /** Size of the evidence pack this was computed against, for reuse staleness. */
  evidenceCount?: number;
}

/**
 * Every read and write in the product goes through this interface.
 *
 * Two drivers implement it: files for a zero-infrastructure demo, Postgres for
 * anything real. Nothing outside src/lib/store knows which is in use, so the
 * swap is an environment variable rather than a refactor.
 */
export interface Store {
  readonly driver: string;

  candidates(): Promise<Candidate[]>;
  roles(): Promise<Role[]>;
  skills(): Promise<Skill[]>;
  applications(): Promise<Application[]>;
  evidence(candidateId: string): Promise<EvidenceDoc[]>;
  resume(candidateId: string): Promise<string>;

  getAssessment(applicationId: string): Promise<StoredAssessment | null>;
  saveAssessment(assessment: StoredAssessment): Promise<void>;

  overrides(applicationId?: string): Promise<Override[]>;
  saveOverride(override: Override): Promise<void>;

  signOff(applicationId: string, reviewer: string): Promise<void>;

  audit(limit?: number): Promise<AuditEntry[]>;
  appendAudit(entry: AuditEntry): Promise<void>;
}
