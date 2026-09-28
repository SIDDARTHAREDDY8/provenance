import type { Artifact } from "@/lib/types";

/**
 * Stable exhibit numbers.
 *
 * Artifacts are cited all over the product — in a claim, in an action's
 * rationale, in the audit log. Giving each one a fixed number, assigned in
 * chronological order once, means a citation reads the same everywhere and a
 * reader can carry E-14 from one screen to the next. The numbering encodes
 * something true (when the work happened); it is not ornament.
 */
export type ExhibitMap = Map<string, string>;

export function exhibitNumbers(artifacts: Artifact[]): ExhibitMap {
  const ordered = [...artifacts].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return new Map(ordered.map((a, i) => [a.id, `E-${String(i + 1).padStart(2, "0")}`]));
}
