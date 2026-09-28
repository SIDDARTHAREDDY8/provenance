import type { Person, Skill, SkillLevel, SkillProfile } from "@/lib/types";
import { levelValue } from "@/lib/types";

/**
 * The employer-facing view.
 *
 * Two rules, both enforced here rather than in the UI, because a rule enforced in
 * the UI is a rule that leaks through the API on the first integration.
 *
 * 1. Opt-out is absolute. A skill the employee marked private is excluded from
 *    the count entirely — not counted-but-hidden.
 * 2. k-anonymity. A bucket is only reported when at least K people are in it.
 *    "1 person on the Payments team has thin Kubernetes evidence" identifies that
 *    person to their manager, which is a performance conversation conducted via
 *    a dashboard nobody agreed to.
 */
export const K_ANONYMITY_THRESHOLD = 5;

export interface SkillAggregate {
  skillId: string;
  label: string;
  /** Null when suppressed — the caller cannot accidentally render a raw count. */
  counts: { strong: number; developing: number; thin: number } | null;
  population: number;
  suppressed: boolean;
  suppressionReason?: "below_k_threshold" | "fully_opted_out";
  optedOut: number;
}

export interface AggregateInput {
  people: Person[];
  profiles: Record<string, SkillProfile>;
  skills: Skill[];
  threshold?: number;
}

export function aggregateSkills({
  people,
  profiles,
  skills,
  threshold = K_ANONYMITY_THRESHOLD,
}: AggregateInput): SkillAggregate[] {
  return skills.map((skill) => {
    let strong = 0;
    let developing = 0;
    let thin = 0;
    let population = 0;
    let optedOut = 0;

    for (const person of people) {
      if (person.privateSkillIds.includes(skill.id)) {
        optedOut += 1;
        continue;
      }
      const profile = profiles[person.id];
      if (!profile) continue;
      population += 1;
      const claim = profile.claims.find((c) => c.skillId === skill.id);
      if (!claim) continue;
      if (claim.thin) thin += 1;
      else if (levelValue(claim.level as SkillLevel) >= levelValue("advanced")) strong += 1;
      else developing += 1;
    }

    const holders = strong + developing + thin;
    if (population === 0) {
      return {
        skillId: skill.id,
        label: skill.label,
        counts: null,
        population,
        suppressed: true,
        suppressionReason: "fully_opted_out",
        optedOut,
      };
    }
    if (holders > 0 && holders < threshold) {
      return {
        skillId: skill.id,
        label: skill.label,
        counts: null,
        population,
        suppressed: true,
        suppressionReason: "below_k_threshold",
        optedOut,
      };
    }

    return {
      skillId: skill.id,
      label: skill.label,
      counts: { strong, developing, thin },
      population,
      suppressed: false,
      optedOut,
    };
  });
}
