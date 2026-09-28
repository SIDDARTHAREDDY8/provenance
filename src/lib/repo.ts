import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  Artifact,
  AuditEntry,
  MentorAction,
  Opening,
  Person,
  Role,
  Skill,
  SkillProfile,
} from "@/lib/types";

/**
 * File-backed repository.
 *
 * The seed corpus is read-only JSON; derived state (profiles, taken actions, the
 * audit log) is written under .data/. Every read goes through this module, so
 * swapping in Postgres is one file rather than a refactor — see ARCHITECTURE.md.
 * If the filesystem is read-only (a serverless deploy), writes fall back to an
 * in-process store so a demo never 500s on a button press.
 */

const DATA = path.join(process.cwd(), "data");
const MUTABLE = path.join(process.cwd(), ".data");

async function readSeed<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(path.join(DATA, file), "utf8")) as T;
}

const memory = new Map<string, unknown>();
let writable = true;

async function readMutable<T>(file: string, fallback: T): Promise<T> {
  if (memory.has(file)) return memory.get(file) as T;
  try {
    const parsed = JSON.parse(await readFile(path.join(MUTABLE, file), "utf8")) as T;
    memory.set(file, parsed);
    return parsed;
  } catch {
    return fallback;
  }
}

async function writeMutable<T>(file: string, value: T): Promise<void> {
  memory.set(file, value);
  if (!writable) return;
  try {
    await mkdir(MUTABLE, { recursive: true });
    await writeFile(path.join(MUTABLE, file), JSON.stringify(value, null, 2), "utf8");
  } catch {
    writable = false;
  }
}

export const repo = {
  skills: () => readSeed<Skill[]>("skills.json"),
  roles: () => readSeed<Role[]>("roles.json"),
  people: () => readSeed<Person[]>("people.json"),
  openings: () => readSeed<Opening[]>("openings.json"),
  artifacts: () => readSeed<Artifact[]>("artifacts.json"),

  async person(id: string): Promise<Person | undefined> {
    return (await repo.people()).find((p) => p.id === id);
  },

  async artifactsFor(personId: string): Promise<Artifact[]> {
    const all = await repo.artifacts();
    return all
      .filter((a) => a.personId === personId)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  },

  /** Profiles for colleagues, used by the aggregate view and mentor pairing. */
  peerProfiles: () => readSeed<Record<string, SkillProfile>>("peer-profiles.json"),

  async profile(personId: string): Promise<SkillProfile | null> {
    const cached = await readMutable<Record<string, SkillProfile>>("profiles.json", {});
    return cached[personId] ?? null;
  },

  async saveProfile(profile: SkillProfile): Promise<void> {
    const cached = await readMutable<Record<string, SkillProfile>>("profiles.json", {});
    cached[profile.personId] = profile;
    await writeMutable("profiles.json", cached);
  },

  async takenActions(personId: string): Promise<MentorAction[]> {
    const all = await readMutable<Record<string, MentorAction[]>>("actions.json", {});
    return all[personId] ?? [];
  },

  async takeAction(personId: string, action: MentorAction): Promise<void> {
    const all = await readMutable<Record<string, MentorAction[]>>("actions.json", {});
    const existing = all[personId] ?? [];
    if (!existing.some((a) => a.id === action.id)) existing.push(action);
    all[personId] = existing;
    await writeMutable("actions.json", all);
  },

  async audit(): Promise<AuditEntry[]> {
    return readMutable<AuditEntry[]>("audit.json", []);
  },

  async appendAudit(entry: AuditEntry): Promise<void> {
    const log = await readMutable<AuditEntry[]>("audit.json", []);
    log.unshift(entry);
    await writeMutable("audit.json", log.slice(0, 500));
  },
};
