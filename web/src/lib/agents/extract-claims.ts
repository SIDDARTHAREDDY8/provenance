import type { ResumeClaim, Skill, SkillLevel } from "@/lib/types";
import { SKILL_LEVELS } from "@/lib/types";
import { buildSkillLookup, canonicaliseSkill, normalise } from "@/lib/verify";
import type { StepDef } from "./runtime";

export interface ExtractInput {
  candidateId: string;
  resume: string;
  skills: Skill[];
}

interface RawClaim {
  text: string;
  category: string;
  section: string;
  skill?: string;
  level?: string;
}

const TOOL = {
  name: "record_resume_claims",
  description: "Record each discrete factual assertion the résumé makes about the candidate.",
  input_schema: {
    type: "object",
    properties: {
      claims: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "The assertion, copied verbatim from the résumé." },
            category: {
              type: "string",
              enum: ["employment", "skill", "achievement", "credential", "scope"],
            },
            section: { type: "string", description: "Heading the assertion appeared under." },
            skill: { type: "string", description: "Taxonomy skill id, if the claim asserts one." },
            level: { type: "string", enum: ["beginner", "intermediate", "advanced", "expert"] },
          },
          required: ["text", "category", "section"],
        },
      },
    },
    required: ["claims"],
  },
} as const;

function isLevel(v: string | undefined): v is SkillLevel {
  return v !== undefined && (SKILL_LEVELS as readonly string[]).includes(v);
}

/**
 * Step 1 — turn prose into discrete, checkable assertions.
 *
 * Nothing is judged here. The only job is to cut the résumé into units small
 * enough that each one can be independently corroborated, and to keep the
 * candidate's own wording so the later verdict is about what they actually
 * wrote rather than a paraphrase of it.
 */
export const extractClaims: StepDef<ExtractInput, ResumeClaim[]> = {
  agent: "extract",
  label: "Split the résumé into discrete claims",
  retries: 1,

  describeInput: (input) => `${input.resume.length} characters of résumé`,
  describeOutput: (claims) => `${claims.length} claims across ${new Set(claims.map((c) => c.section)).size} sections`,

  async execute(input, ctx) {
    const taxonomy = input.skills.map((s) => `- ${s.id} (${s.label})`).join("\n");
    const raw = await ctx.llm.structured<{ claims: RawClaim[] }>({
      cacheKey: `extract/${input.candidateId}`,
      system:
        "You segment résumés into discrete factual assertions. You do not assess, rank or judge them.",
      prompt: `Split this résumé into discrete assertions. One assertion per claim — "Led a team of 8 while migrating the ledger" is two claims, not one.

Copy each assertion VERBATIM from the résumé. Do not paraphrase, summarise or correct grammar: a later step checks these strings against the source, and a rewritten claim cannot be checked.

Where an assertion is about a named capability, map it to a skill id from this taxonomy and give the level the résumé asserts:
${taxonomy}

RÉSUMÉ
${input.resume}`,
      tool: TOOL,
    });

    const lookup = buildSkillLookup(input.skills);
    return (raw.claims ?? []).map((c, i) => ({
      id: `claim_${String(i + 1).padStart(2, "0")}`,
      candidateId: input.candidateId,
      text: c.text.trim(),
      category: (["employment", "skill", "achievement", "credential", "scope"] as const).includes(
        c.category as never,
      )
        ? (c.category as ResumeClaim["category"])
        : "achievement",
      section: c.section,
      skillId: canonicaliseSkill(c.skill, lookup),
      assertedLevel: isLevel(c.level) ? c.level : undefined,
    }));
  },

  /**
   * The gate: a claim the résumé does not contain is a claim we invented, and
   * building a verification product on invented claims would be absurd.
   */
  check(claims, input) {
    const haystack = normalise(input.resume);
    const drifted = claims.filter((c) => !haystack.includes(normalise(c.text)));
    return [
      {
        name: "claims are verbatim",
        passed: drifted.length === 0,
        detail:
          drifted.length === 0
            ? `all ${claims.length} claims found verbatim in the source résumé`
            : `${drifted.length} claim(s) not present in the résumé: ${drifted
                .map((d) => `"${d.text.slice(0, 48)}…"`)
                .join(", ")}`,
      },
      {
        name: "coverage",
        passed: claims.length >= 6,
        detail: `${claims.length} claims extracted`,
      },
    ];
  },
};
