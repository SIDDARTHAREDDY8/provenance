import { randomUUID } from "node:crypto";
import { store } from "@/lib/store";
import type { AuditEntry, AuditEventKind } from "@/lib/types";

/**
 * Every inference and every disclosure gets a row, written where it happens.
 *
 * The EU AI Act puts employment and worker-management systems in the high-risk
 * category, which carries record-keeping and human-oversight obligations, and
 * the Mobley v. Workday litigation turns on who decided what. Logging at the
 * point of inference is cheap. Reconstructing six months later who saw what,
 * and which version of which model produced it, is not possible at all.
 */
export async function record(
  kind: AuditEventKind,
  actor: string,
  summary: string,
  extra: { subjectId?: string; detail?: Record<string, unknown> } = {},
): Promise<void> {
  await store().appendAudit({
    id: randomUUID(),
    at: new Date().toISOString(),
    kind,
    actor,
    summary,
    ...extra,
  } satisfies AuditEntry);
}
