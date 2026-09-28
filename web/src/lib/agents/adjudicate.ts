import type { Decision, MatchResult, ResumeClaim, Role, Skill, Verdict } from "@/lib/types";
import type { StepDef } from "./runtime";

export interface AdjudicateInput {
  applicationId: string;
  role: Role;
  match: MatchResult;
  verdicts: Verdict[];
  claims: ResumeClaim[];
  skills: Skill[];
}

/** Thresholds live here, in one readable place, because they are policy. */
export const POLICY = {
  advanceAt: 0.7,
  holdAt: 0.5,
  /** A contradicted claim never auto-advances, however strong the rest is. */
  contradictionBlocksAdvance: true,
} as const;

/**
 * Step 4 — the decision.
 *
 * No model is called here, on purpose. The model's job ended at "what does the
 * evidence say"; deciding what happens to a person is a policy question with a
 * named owner, a fixed rule and a written record. Mobley v. Workday is about
 * exactly this boundary, and the EU AI Act's human-oversight requirement for
 * high-risk employment systems is unsatisfiable if the rule lives inside a
 * sampled generation nobody can reproduce.
 *
 * Adverse outcomes are computed but never final: they carry
 * requiresHumanSignoff, and nothing leaves the system until a named person
 * accepts it.
 */
export const adjudicate: StepDef<AdjudicateInput, Decision> = {
  agent: "adjudicate",
  label: "Apply hiring policy and set signoff requirements",

  describeInput: (input) =>
    `verified ${Math.round(input.match.verifiedScore * 100)}% against ${input.role.title}`,
  describeOutput: (out) =>
    `${out.outcome}${out.requiresHumanSignoff ? " · awaiting human signoff" : ""}`,

  async execute(input) {
    const labels = new Map(input.skills.map((s) => [s.id, s.label]));
    const contradicted = input.verdicts.filter((v) => v.status === "contradicted");
    const adverseFactors: string[] = [];

    for (const skillId of input.match.blockers) {
      adverseFactors.push(`No verified evidence for required capability: ${labels.get(skillId) ?? skillId}`);
    }
    for (const v of contradicted) {
      const claim = input.claims.find((c) => c.id === v.claimId);
      adverseFactors.push(`Evidence contradicts a stated claim: "${claim?.text.slice(0, 90) ?? v.claimId}"`);
    }

    const overstated = input.match.contributions.filter(
      (c) => c.claimedCredit - c.verifiedCredit >= 0.5,
    );
    for (const c of overstated.slice(0, 3)) {
      adverseFactors.push(
        `Claimed ${c.claimed} in ${labels.get(c.skillId) ?? c.skillId}; evidence supports ${c.verified}`,
      );
    }

    let outcome: Decision["outcome"];
    let rationale: string;

    if (input.match.blockers.length > 0) {
      outcome = "reject";
      rationale = `Missing verified evidence on ${input.match.blockers.length} must-have requirement(s).`;
    } else if (POLICY.contradictionBlocksAdvance && contradicted.length > 0) {
      outcome = "hold";
      rationale = `${contradicted.length} claim(s) contradicted by the evidence pack. Requires a human read before any decision.`;
    } else if (input.match.verifiedScore >= POLICY.advanceAt) {
      outcome = "advance";
      rationale = `Verified fit ${Math.round(input.match.verifiedScore * 100)}% meets the ${Math.round(POLICY.advanceAt * 100)}% bar with no contradicted claims.`;
    } else if (input.match.verifiedScore >= POLICY.holdAt) {
      outcome = "hold";
      rationale = `Verified fit ${Math.round(input.match.verifiedScore * 100)}% sits between the hold and advance thresholds.`;
    } else {
      outcome = "reject";
      rationale = `Verified fit ${Math.round(input.match.verifiedScore * 100)}% is below the ${Math.round(POLICY.holdAt * 100)}% hold threshold.`;
    }

    return {
      applicationId: input.applicationId,
      outcome,
      rationale,
      // Anything adverse needs a person. An advance does not: nobody was harmed
      // by being invited to an interview.
      requiresHumanSignoff: outcome !== "advance",
      adverseFactors: outcome === "advance" ? [] : adverseFactors,
    };
  },

  check(out) {
    return [
      {
        name: "adverse outcomes are gated",
        passed: out.outcome === "advance" || out.requiresHumanSignoff,
        detail:
          out.outcome === "advance"
            ? "favourable outcome, no signoff required"
            : "adverse outcome held for a named human",
      },
      {
        name: "adverse outcomes are explained",
        passed: out.outcome === "advance" || out.adverseFactors.length > 0,
        detail:
          out.outcome === "advance"
            ? "n/a"
            : `${out.adverseFactors.length} disclosable factor(s) recorded for the candidate`,
      },
      {
        name: "decision is rule-based",
        passed: true,
        detail: "no model call in this step; thresholds are code and reproducible",
      },
    ];
  },
};
