import type { Artifact, RejectedClaim, Skill, SkillClaim, SkillLevel, SkillProfile } from "@/lib/types";
import { SKILL_LEVELS, levelValue } from "@/lib/types";
import { selectProvider, type LlmProvider, type RawClaim } from "@/lib/llm";
import { buildSkillIndex, validateClaims } from "./validate";
import { capLevel, scoreConfidence } from "./confidence";

/**
 * Batch size is a correctness knob, not just a cost one. Long contexts encourage
 * the model to attribute a quote to the wrong artifact id; smaller batches keep
 * ids close to their text. The validator catches those errors, but catching
 * fewer of them is better than catching more.
 */
export const BATCH_SIZE = 6;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isLevel(value: string): value is SkillLevel {
  return (SKILL_LEVELS as readonly string[]).includes(value);
}

export interface ExtractOptions {
  provider?: LlmProvider;
  now?: Date;
}

export async function extractProfile(
  personId: string,
  artifacts: Artifact[],
  skills: Skill[],
  options: ExtractOptions = {},
): Promise<SkillProfile> {
  const provider = options.provider ?? selectProvider();
  const index = buildSkillIndex(skills);
  const artifactsById = new Map(artifacts.map((a) => [a.id, a]));

  const batches = chunk(artifacts, BATCH_SIZE);
  const raw: RawClaim[] = [];
  const rejected: RejectedClaim[] = [];

  // Sequential on purpose: a rate-limit failure halfway through a parallel fan-out
  // gives a silently partial profile, which is worse than a slower complete one.
  for (const batch of batches) {
    raw.push(...(await provider.extract({ artifacts: batch, skills })));
  }

  const validation = validateClaims(raw, artifacts, index);
  rejected.push(...validation.rejected);

  // Merge per skill across batches: one skill, one claim, all its evidence.
  interface MergeEntry {
    levels: SkillLevel[];
    evidence: Map<string, string>;
  }
  const bySkill = new Map<string, MergeEntry>();
  for (const claim of validation.accepted) {
    if (!isLevel(claim.level)) continue;
    const entry: MergeEntry =
      bySkill.get(claim.skillId) ?? { levels: [], evidence: new Map<string, string>() };
    entry.levels.push(claim.level);
    for (const ev of claim.evidence) {
      // Dedupe by artifact, keeping the longest quote as the most informative one.
      const existing = entry.evidence.get(ev.artifactId);
      if (!existing || ev.quote.length > existing.length) entry.evidence.set(ev.artifactId, ev.quote);
    }
    bySkill.set(claim.skillId, entry);
  }

  const claims: SkillClaim[] = [];
  for (const [skillId, entry] of bySkill) {
    const evidence = [...entry.evidence].map(([artifactId, quote]) => ({ artifactId, quote }));
    const scored = scoreConfidence({ evidence, artifactsById, now: options.now });
    const claimed = entry.levels.reduce<SkillLevel>(
      (max, l) => (levelValue(l) > levelValue(max) ? l : max),
      "beginner",
    );
    claims.push({
      skillId,
      level: capLevel(claimed, scored.ceiling),
      confidence: scored.confidence,
      evidence,
      thin: scored.thin,
    });
  }

  claims.sort((a, b) => levelValue(b.level) - levelValue(a.level) || b.confidence - a.confidence);

  return {
    personId,
    claims,
    generatedAt: (options.now ?? new Date()).toISOString(),
    provider: provider.name,
    model: provider.model,
    rejected,
    rawClaimCount: raw.length,
  };
}
