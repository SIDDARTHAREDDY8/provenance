import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
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

const SEED = path.join(process.cwd(), "data");
const MUTABLE = path.join(process.cwd(), ".data");

/**
 * File-backed store for the zero-infrastructure path.
 *
 * Writes fall back to an in-process map when the filesystem is read-only, so a
 * serverless deploy of the demo still works rather than failing on the first
 * button press.
 */
export class FileStore implements Store {
  readonly driver = "file";
  private memory = new Map<string, unknown>();
  /** mtimeMs of each cached file, so another process's writes are noticed. */
  private cachedAt = new Map<string, number>();
  private writable = true;

  private async seed<T>(file: string): Promise<T> {
    return JSON.parse(await readFile(path.join(SEED, file), "utf8")) as T;
  }

  /**
   * Read-through cache that revalidates on mtime.
   *
   * Without the mtime check this cache is a data-loss bug rather than an
   * optimisation: a dev server and a CLI script both holding a stale copy will
   * read-modify-write over each other, and the last writer silently wins. That
   * is how the audit log lost an entire assessment run during testing.
   */
  private async read<T>(file: string, fallback: T): Promise<T> {
    const full = path.join(MUTABLE, file);
    let mtime: number | null = null;
    try {
      mtime = (await stat(full)).mtimeMs;
    } catch {
      mtime = null;
    }

    if (this.memory.has(file) && this.cachedAt.get(file) === mtime) {
      return this.memory.get(file) as T;
    }
    if (mtime === null) return fallback;

    try {
      const parsed = JSON.parse(await readFile(full, "utf8")) as T;
      this.memory.set(file, parsed);
      this.cachedAt.set(file, mtime);
      return parsed;
    } catch {
      return fallback;
    }
  }

  private async write<T>(file: string, value: T): Promise<void> {
    this.memory.set(file, value);
    if (!this.writable) return;
    try {
      await mkdir(MUTABLE, { recursive: true });
      const full = path.join(MUTABLE, file);
      await writeFile(full, JSON.stringify(value, null, 2), "utf8");
      this.cachedAt.set(file, (await stat(full)).mtimeMs);
    } catch {
      this.writable = false;
    }
  }

  candidates = () => this.seed<Candidate[]>("candidates.json");
  roles = () => this.seed<Role[]>("roles.json");
  skills = () => this.seed<Skill[]>("skills.json");
  applications = () => this.seed<Application[]>("applications.json");

  async evidence(candidateId: string): Promise<EvidenceDoc[]> {
    const all = await this.seed<EvidenceDoc[]>("evidence.json");
    return all
      .filter((d) => d.candidateId === candidateId)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }

  async resume(candidateId: string): Promise<string> {
    const resumes = await this.seed<Record<string, string>>("resumes.json");
    return resumes[candidateId] ?? "";
  }

  async getAssessment(applicationId: string): Promise<StoredAssessment | null> {
    const all = await this.read<Record<string, StoredAssessment>>("assessments.json", {});
    return all[applicationId] ?? null;
  }

  async saveAssessment(assessment: StoredAssessment): Promise<void> {
    const all = await this.read<Record<string, StoredAssessment>>("assessments.json", {});
    all[assessment.applicationId] = assessment;
    await this.write("assessments.json", all);
  }

  async overrides(applicationId?: string): Promise<Override[]> {
    const all = await this.read<Override[]>("overrides.json", []);
    return applicationId ? all.filter((o) => o.applicationId === applicationId) : all;
  }

  async saveOverride(override: Override): Promise<void> {
    const all = await this.read<Override[]>("overrides.json", []);
    all.unshift(override);
    await this.write("overrides.json", all);
  }

  async signOff(applicationId: string, reviewer: string): Promise<void> {
    const all = await this.read<Record<string, StoredAssessment>>("assessments.json", {});
    const assessment = all[applicationId];
    if (!assessment) return;
    assessment.decision.signedOffBy = reviewer;
    assessment.decision.signedOffAt = new Date().toISOString();
    await this.write("assessments.json", all);
  }

  /**
   * The audit log is append-only, one JSON object per line.
   *
   * It was a JSON array rewritten in full on every append, which meant every
   * write could truncate the file to whatever that process last read. An audit
   * log with a read-modify-write cycle is not an audit log. Appending a line is
   * also the only form of concurrent write that survives two processes without
   * a lock.
   */
  async audit(limit = 200): Promise<AuditEntry[]> {
    try {
      const raw = await readFile(path.join(MUTABLE, "audit.jsonl"), "utf8");
      const entries = raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as AuditEntry);
      return entries.reverse().slice(0, limit);
    } catch {
      return [];
    }
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    if (!this.writable) return;
    try {
      await mkdir(MUTABLE, { recursive: true });
      await appendFile(path.join(MUTABLE, "audit.jsonl"), JSON.stringify(entry) + "\n", "utf8");
    } catch {
      this.writable = false;
    }
  }
}
