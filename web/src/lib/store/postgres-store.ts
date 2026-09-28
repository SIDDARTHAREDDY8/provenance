import type { Pool } from "pg";
import type { Store, StoredAssessment } from "./types";
import type {
  Application,
  AuditEntry,
  Candidate,
  EvidenceDoc,
  Override,
  Role,
  Skill,
} from "@/lib/types";

/**
 * Postgres driver, used when DATABASE_URL is set.
 *
 * Assessment output is stored as jsonb rather than shredded across a dozen
 * tables: it is an immutable record of what one run concluded, always read as a
 * whole, and normalising it would buy nothing but migrations. The things that
 * are queried independently — overrides, the audit log, evidence — are real
 * columns. Schema in db/schema.sql.
 */
export class PostgresStore implements Store {
  readonly driver = "postgres";
  private pool: Pool | null = null;

  constructor(private readonly url: string) {}

  private async db(): Promise<Pool> {
    if (this.pool) return this.pool;
    // Dynamic import: the file path is never loaded when running on files, so
    // pg stays out of the bundle and off the cold-start path.
    const { Pool: PgPool } = await import("pg");
    this.pool = new PgPool({ connectionString: this.url, max: 8 });
    return this.pool;
  }

  private async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const pool = await this.db();
    const res = await pool.query(sql, params);
    return res.rows as T[];
  }

  async candidates(): Promise<Candidate[]> {
    return this.rows<Candidate>(
      `select id, name, headline, location, private_skill_ids as "privateSkillIds" from candidate order by name`,
    );
  }

  async roles(): Promise<Role[]> {
    return this.rows<Role>(`select id, title, team, level, requirements from role order by title`);
  }

  async skills(): Promise<Skill[]> {
    return this.rows<Skill>(`select id, label, dimension, aliases from skill order by id`);
  }

  async applications(): Promise<Application[]> {
    return this.rows<Application>(
      `select id, candidate_id as "candidateId", role_id as "roleId", submitted_at as "submittedAt"
       from application order by submitted_at desc`,
    );
  }

  async evidence(candidateId: string): Promise<EvidenceDoc[]> {
    return this.rows<EvidenceDoc>(
      `select id, candidate_id as "candidateId", kind, source, title, body,
              occurred_at as "occurredAt", url, attested
       from evidence_doc where candidate_id = $1 order by occurred_at`,
      [candidateId],
    );
  }

  async resume(candidateId: string): Promise<string> {
    const [row] = await this.rows<{ body: string }>(
      `select body from resume where candidate_id = $1`,
      [candidateId],
    );
    return row?.body ?? "";
  }

  async getAssessment(applicationId: string): Promise<StoredAssessment | null> {
    const [row] = await this.rows<{ payload: StoredAssessment }>(
      `select payload from assessment where application_id = $1 order by created_at desc limit 1`,
      [applicationId],
    );
    return row?.payload ?? null;
  }

  async saveAssessment(assessment: StoredAssessment): Promise<void> {
    const pool = await this.db();
    await pool.query(
      `insert into assessment (application_id, run_id, payload) values ($1, $2, $3)`,
      [assessment.applicationId, assessment.run.id, JSON.stringify(assessment)],
    );
  }

  async overrides(applicationId?: string): Promise<Override[]> {
    const where = applicationId ? `where application_id = $1` : "";
    return this.rows<Override>(
      `select id, at, reviewer, application_id as "applicationId", target_type as "targetType",
              target_id as "targetId", before_value as "before", after_value as "after",
              rationale, promoted_to_eval as "promotedToEval"
       from override ${where} order by at desc`,
      applicationId ? [applicationId] : [],
    );
  }

  async saveOverride(o: Override): Promise<void> {
    const pool = await this.db();
    await pool.query(
      `insert into override (id, at, reviewer, application_id, target_type, target_id,
                             before_value, after_value, rationale, promoted_to_eval)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [o.id, o.at, o.reviewer, o.applicationId, o.targetType, o.targetId, o.before, o.after, o.rationale, o.promotedToEval],
    );
  }

  async signOff(applicationId: string, reviewer: string): Promise<void> {
    const pool = await this.db();
    // jsonb_set keeps the record immutable in shape while recording the human
    // acceptance that the policy layer requires before an adverse outcome ships.
    await pool.query(
      `update assessment
         set payload = jsonb_set(
               jsonb_set(payload, '{decision,signedOffBy}', to_jsonb($2::text), true),
               '{decision,signedOffAt}', to_jsonb(now()::text), true)
       where application_id = $1`,
      [applicationId, reviewer],
    );
  }

  async audit(limit = 200): Promise<AuditEntry[]> {
    return this.rows<AuditEntry>(
      `select id, at, kind, actor, subject_id as "subjectId", summary, detail
       from audit_entry order by at desc limit $1`,
      [limit],
    );
  }

  async appendAudit(e: AuditEntry): Promise<void> {
    const pool = await this.db();
    await pool.query(
      `insert into audit_entry (id, at, kind, actor, subject_id, summary, detail)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [e.id, e.at, e.kind, e.actor, e.subjectId ?? null, e.summary, e.detail ? JSON.stringify(e.detail) : null],
    );
  }
}
