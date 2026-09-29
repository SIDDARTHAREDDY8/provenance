import type { Contribution, MatchResult, ResumeClaim, Role, SkillLevel, Verdict } from "@/lib/types";
import { levelValue } from "@/lib/types";
import type { StepDef } from "./runtime";

export interface MatchInput {
  candidateId: string;
  role: Role;
  claims: ResumeClaim[];
  verdicts: Verdict[];
}

/**
 * Step 3 — scoring. Deterministic, and deliberately so.
 *
 * Two numbers are produced for every role: the score you get if you believe the
 * résumé, and the score you get from what the evidence supports. Publishing only
 * the second would be more flattering to the product; publishing both is the
 * entire argument, because the gap between them is the thing nobody currently
 * measures.
 *
 * No model is involved past this point. A ranking that decides who gets seen has
 * to be reproducible, inspectable and explainable line by line — which a sampled
 * generation is not, and which regulators are increasingly explicit about.
 */
export const scoreMatch: StepDef<MatchInput, MatchResult> = {
  agent: "score",
  label: "Score claimed fit against verified fit",

  describeInput: (input) => `${input.role.requirements.length} requirements for ${input.role.title}`,
  describeOutput: (out) =>
    `claimed ${Math.round(out.claimedScore * 100)}% · verified ${Math.round(out.verifiedScore * 100)}%` +
    (out.blockers.length ? ` · ${out.blockers.length} blocker(s)` : ""),

  async execute(input) {
    const verdictByClaim = new Map(input.verdicts.map((v) => [v.claimId, v]));
    const contributions: Contribution[] = [];
    const blockers: string[] = [];
    let claimedEarned = 0;
    let verifiedEarned = 0;
    let total = 0;

    for (const req of input.role.requirements) {
      const relevant = input.claims.filter((c) => c.skillId === req.skillId);

      // The claimed side models what a keyword-matching ATS does: the skill
      // appears on the résumé, so the requirement counts as met. Where the
      // résumé states a level outright ("Expert-level Kafka") that is used
      // instead, but an unstated level is not inferred from prose.
      //
      // An earlier version asked the model for a level on every claim and
      // scored on the answer. Running it live exposed that: the model declined
      // to assign one on 16 of 18 claims, correctly, because the résumé does
      // not state one. Scoring on an invented seniority level would have been
      // the same unfounded inference this pipeline exists to catch.
      const stated = relevant.reduce<SkillLevel>(
        (max, c) => (levelValue(c.assertedLevel ?? "none") > levelValue(max) ? c.assertedLevel ?? max : max),
        "none",
      );
      const claimed: SkillLevel = levelValue(stated) > 0 ? stated : relevant.length > 0 ? req.minLevel : "none";

      const verified = relevant.reduce<SkillLevel>((max, c) => {
        const v = verdictByClaim.get(c.id);
        if (!v || (v.status !== "verified" && v.status !== "partially_verified")) return max;
        const level = v.supportedLevel ?? c.assertedLevel ?? "none";
        return levelValue(level) > levelValue(max) ? level : max;
      }, "none");

      const required = levelValue(req.minLevel);
      // Partial credit: one level short of an advanced requirement is genuinely
      // closer than never having touched the skill, and a binary met/unmet score
      // throws away exactly the signal a hiring team needs to calibrate.
      const claimedCredit = required === 0 ? 1 : Math.min(1, levelValue(claimed) / required);
      const verifiedCredit = required === 0 ? 1 : Math.min(1, levelValue(verified) / required);

      total += req.weight;
      claimedEarned += claimedCredit * req.weight;
      verifiedEarned += verifiedCredit * req.weight;

      if (req.mustHave && levelValue(verified) < required) blockers.push(req.skillId);

      contributions.push({
        skillId: req.skillId,
        weight: req.weight,
        claimed,
        verified,
        claimedCredit: Number(claimedCredit.toFixed(3)),
        verifiedCredit: Number(verifiedCredit.toFixed(3)),
      });
    }

    contributions.sort(
      (a, b) => (b.claimedCredit - b.verifiedCredit) * b.weight - (a.claimedCredit - a.verifiedCredit) * a.weight,
    );

    return {
      roleId: input.role.id,
      candidateId: input.candidateId,
      claimedScore: total === 0 ? 0 : Number((claimedEarned / total).toFixed(3)),
      verifiedScore: total === 0 ? 0 : Number((verifiedEarned / total).toFixed(3)),
      contributions,
      blockers,
    };
  },

  check(out) {
    return [
      {
        name: "verification cannot inflate",
        passed: out.verifiedScore <= out.claimedScore + 1e-9,
        detail: `verified ${out.verifiedScore} ≤ claimed ${out.claimedScore}`,
      },
      {
        name: "every requirement scored",
        passed: out.contributions.length > 0,
        detail: `${out.contributions.length} requirements contributed to the score`,
      },
    ];
  },
};
