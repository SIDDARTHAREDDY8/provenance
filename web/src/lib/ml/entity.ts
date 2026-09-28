/**
 * Entity resolution for skill and organisation mentions.
 *
 * Evidence packs are written by humans across years and systems, so the same
 * capability appears as "PostgreSQL", "Postgres", "psql" and "pg". Resolving
 * these before scoring is unglamorous and decides more outcomes than the model
 * does: an unresolved alias is an unverified claim, and an unverified claim is a
 * rejected candidate.
 */

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aFlags = new Array<boolean>(a.length).fill(false);
  const bFlags = new Array<boolean>(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bFlags[j] || a[i] !== b[j]) continue;
      aFlags[i] = true;
      bFlags[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aFlags[i]) continue;
    while (!bFlags[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions) / m) / 3;

  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

export function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

export interface ResolutionCandidate {
  id: string;
  label: string;
  aliases: string[];
}

export interface Resolution {
  id: string | null;
  score: number;
  matchedOn: string | null;
}

const ACCEPT = 0.87;

/**
 * Blocking on first character before scoring. With twenty skills it is
 * pointless; with fifty thousand entities it is the difference between a
 * millisecond and a minute, and the resolver should not need rewriting then.
 */
export function resolveEntity(surface: string, candidates: ResolutionCandidate[]): Resolution {
  const needle = surface.trim().toLowerCase();
  if (!needle) return { id: null, score: 0, matchedOn: null };

  let best: Resolution = { id: null, score: 0, matchedOn: null };
  const blockKey = needle[0];

  for (const cand of candidates) {
    for (const form of [cand.id, cand.label, ...cand.aliases]) {
      const f = form.toLowerCase();
      if (f === needle) return { id: cand.id, score: 1, matchedOn: form };
      // Skip only when both are long enough that a first-character mismatch is
      // a reliable negative; short forms like "ts" / "js" stay in the pool.
      if (f[0] !== blockKey && f.length > 4 && needle.length > 4) continue;

      const score = Math.max(jaroWinkler(f, needle), tokenSetRatio(f, needle));
      if (score > best.score) best = { id: cand.id, score: Number(score.toFixed(3)), matchedOn: form };
    }
  }

  return best.score >= ACCEPT ? best : { id: null, score: best.score, matchedOn: best.matchedOn };
}
