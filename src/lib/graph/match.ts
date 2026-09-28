import type { Gap, Match, Role, SkillClaim, SkillLevel } from "@/lib/types";
import { levelValue } from "@/lib/types";

export interface MatchInput {
  claims: SkillClaim[];
  roles: Role[];
  /**
   * Whether a thin claim counts towards a requirement. Defaults to false: for a
   * promotion decision, "we think maybe" should not read as "meets the bar".
   */
  countThin?: boolean;
}

export function currentLevel(claims: SkillClaim[], skillId: string, countThin: boolean): SkillLevel {
  const claim = claims.find((c) => c.skillId === skillId);
  if (!claim) return "none";
  if (claim.thin && !countThin) return "none";
  return claim.level;
}

export function matchRole(role: Role, claims: SkillClaim[], countThin = false): Match {
  const met: { skillId: string; level: SkillLevel }[] = [];
  const gaps: Gap[] = [];
  let earned = 0;
  let total = 0;
  let stretch = 0;

  for (const req of role.requirements) {
    const required = levelValue(req.minLevel);
    const have = levelValue(currentLevel(claims, req.skillId, countThin));
    total += req.weight;

    // Partial credit: one level short of an advanced requirement is genuinely
    // closer than having never touched the skill, and a binary met/unmet score
    // hides exactly the information a career-pathing product exists to surface.
    const credit = required === 0 ? 1 : Math.min(1, have / required);
    earned += credit * req.weight;

    if (have >= required) {
      met.push({ skillId: req.skillId, level: currentLevel(claims, req.skillId, countThin) });
    } else {
      const distance = required - have;
      stretch += distance * req.weight;
      gaps.push({
        skillId: req.skillId,
        required: req.minLevel,
        current: currentLevel(claims, req.skillId, countThin),
        distance,
        weight: req.weight,
        unevidenced: !claims.some((c) => c.skillId === req.skillId),
      });
    }
  }

  gaps.sort((a, b) => b.weight * b.distance - a.weight * a.distance);

  return {
    roleId: role.id,
    score: total === 0 ? 0 : Number((earned / total).toFixed(3)),
    met,
    gaps,
    stretch,
  };
}

export function matchAll({ claims, roles, countThin = false }: MatchInput): Match[] {
  return roles
    .map((role) => matchRole(role, claims, countThin))
    .sort((a, b) => b.score - a.score || a.stretch - b.stretch);
}
