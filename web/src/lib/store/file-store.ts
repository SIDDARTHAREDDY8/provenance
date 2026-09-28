import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  private writable = true;

  private async seed<T>(file: string): Promise<T> {
    return JSON.parse(await readFile(path.join(SEED, file), "utf8")) as T;
  }

  private async read<T>(file: string, fallback: T): Promise<T> {
    if (this.memory.has(file)) return this.memory.get(file) as T;
    try {
      const parsed = JSON.parse(await readFile(path.join(MUTABLE, file), "utf8")) as T;
      this.memory.set(file, parsed);
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
      await writeFile(path.join(MUTABLE, file), JSON.stringify(value, null, 2), "utf8");
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

  async audit(limit = 200): Promise<AuditEntry[]> {
    const log = await this.read<AuditEntry[]>("audit.json", []);
    return log.slice(0, limit);
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    const log = await this.read<AuditEntry[]>("audit.json", []);
    log.unshift(entry);
    await this.write("audit.json", log.slice(0, 500));
  }
}
