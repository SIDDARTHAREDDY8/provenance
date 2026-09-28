import type { Artifact, Skill } from "@/lib/types";

/** What a model is allowed to hand back. Deliberately loose: the validator is the gate. */
export interface RawClaim {
  skill: string;
  level: string;
  evidence: { artifactId: string; quote: string }[];
}

export interface ExtractionBatch {
  artifacts: Artifact[];
  skills: Skill[];
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  extract(batch: ExtractionBatch): Promise<RawClaim[]>;
}

/**
 * The extraction contract.
 *
 * Two rules do the real work here. "Quote verbatim" makes hallucination
 * mechanically detectable — we can string-search the source. "Omit the skill
 * rather than guess" is what stops the profile filling up with plausible
 * nonsense, which is the failure mode that makes HR AI untrustworthy.
 */
export function buildPrompt(batch: ExtractionBatch): string {
  const taxonomy = batch.skills
    .map((s) => `- ${s.id} (${s.label}) [${s.dimension}]`)
    .join("\n");

  const artifacts = batch.artifacts
    .map(
      (a) =>
        `<artifact id="${a.id}" kind="${a.kind}" source="${a.source}" date="${a.occurredAt}">\n` +
        `${a.title}\n\n${a.body}\n</artifact>`,
    )
    .join("\n\n");

  return `You are extracting demonstrated skills from an engineer's own work record.

TAXONOMY — use these skill ids only:
${taxonomy}

RULES
1. Only claim a skill if these artifacts contain direct evidence of the person doing it.
2. Every claim must carry at least one quote copied VERBATIM from the artifact text. Copy the characters exactly; do not paraphrase, trim mid-word, or fix punctuation.
3. Assign level from the evidence: beginner (touched it), intermediate (did it unsupervised), advanced (owned hard cases, made judgement calls), expert (set direction others follow).
4. If the evidence is ambiguous, claim the LOWER level.
5. If a skill in the taxonomy has no evidence here, omit it. Do not infer it from job title, team, or adjacency to another skill. An absent skill is a useful signal; a guessed skill is a defect.
6. Evidence of someone else doing the work is not evidence about this person.

ARTIFACTS
${artifacts}

Return claims via the record_skill_claims tool.`;
}

export const CLAIM_TOOL_SCHEMA = {
  name: "record_skill_claims",
  description: "Record evidence-backed skill claims extracted from the artifacts.",
  input_schema: {
    type: "object",
    properties: {
      claims: {
        type: "array",
        items: {
          type: "object",
          properties: {
            skill: { type: "string", description: "A skill id from the taxonomy." },
            level: {
              type: "string",
              enum: ["beginner", "intermediate", "advanced", "expert"],
            },
            evidence: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  artifactId: { type: "string" },
                  quote: {
                    type: "string",
                    description: "Verbatim span from that artifact's title or body.",
                  },
                },
                required: ["artifactId", "quote"],
              },
            },
          },
          required: ["skill", "level", "evidence"],
        },
      },
    },
    required: ["claims"],
  },
} as const;
