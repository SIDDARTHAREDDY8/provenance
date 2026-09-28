import { randomUUID } from "node:crypto";
import { repo } from "@/lib/repo";
import type { AuditEntry, AuditEventKind } from "@/lib/types";

/**
 * Every inference and every disclosure gets a row.
 *
 * This is not decoration. Under the EU AI Act, worker-management systems sit in
 * the high-risk category, which carries record-keeping and human-oversight
 * obligations. Logging at the point of inference is cheap; reconstructing who
 * saw what six months later is not possible at all.
 */
export async function record(
  kind: AuditEventKind,
  actor: string,
  summary: string,
  extra: { subjectPersonId?: string; detail?: Record<string, unknown> } = {},
): Promise<void> {
  const entry: AuditEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind,
    actor,
    summary,
    ...extra,
  };
  await repo.appendAudit(entry);
}
