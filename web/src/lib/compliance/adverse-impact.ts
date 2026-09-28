/**
 * Adverse-impact monitoring.
 *
 * The four-fifths rule: if a group's selection rate is below 80% of the
 * best-performing group's, that is the threshold US enforcement agencies have
 * used since 1978 to flag a screen for examination. It is a smoke alarm, not a
 * verdict — a flagged ratio means look, not stop.
 *
 * A hiring product that scores people and does not measure this is choosing not
 * to know. Mobley v. Workday is the current argument about whether a vendor can
 * make that choice; building the monitor in is cheaper than the discovery
 * process that follows from not having it.
 */

export interface CohortRow {
  /** Voluntarily self-disclosed, aggregate-only, never joined to a decision record. */
  group: string;
  advanced: boolean;
}

export interface GroupRate {
  group: string;
  /** Null when the group is too small to report without identifying people. */
  rate: number | null;
  n: number;
  suppressed: boolean;
  /** Selection rate relative to the highest-scoring reportable group. */
  impactRatio: number | null;
  flagged: boolean;
}

export const K_ANONYMITY_THRESHOLD = 5;
export const FOUR_FIFTHS = 0.8;

export function adverseImpact(rows: CohortRow[], threshold = K_ANONYMITY_THRESHOLD): GroupRate[] {
  const groups = new Map<string, { n: number; advanced: number }>();
  for (const row of rows) {
    const g = groups.get(row.group) ?? { n: 0, advanced: 0 };
    g.n += 1;
    if (row.advanced) g.advanced += 1;
    groups.set(row.group, g);
  }

  const raw = [...groups].map(([group, g]) => ({
    group,
    n: g.n,
    suppressed: g.n < threshold,
    rate: g.n < threshold ? null : Number((g.advanced / g.n).toFixed(4)),
  }));

  // The reference rate is computed over reportable groups only. Deriving it
  // from a suppressed group would leak that group's rate through the ratio.
  const best = raw.reduce((max, r) => (r.rate !== null && r.rate > max ? r.rate : max), 0);

  return raw
    .map((r) => {
      const impactRatio = r.rate === null || best === 0 ? null : Number((r.rate / best).toFixed(3));
      return {
        ...r,
        impactRatio,
        flagged: impactRatio !== null && impactRatio < FOUR_FIFTHS,
      };
    })
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
}
