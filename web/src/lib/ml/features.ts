import type { ResumeClaim } from "@/lib/types";

/**
 * Feature extraction for the claim-risk classifier.
 *
 * This definition is mirrored in ml/app/features.py and the two are checked
 * against each other by ml/app/evaluate.py. Training/serving skew in a model
 * that decides where to spend verification effort would show up as quietly
 * worse verification, which is the kind of bug nobody notices for a quarter.
 */
export const FEATURE_VERSION = 2;

export const FEATURE_NAMES = [
  "has_number",
  "has_large_number",
  "has_superlative",
  "has_scope_verb",
  "asserts_level",
  "asserts_top_level",
  "is_achievement",
  "is_credential",
  "word_count_norm",
  "retrieval_max",
  "retrieval_mean",
  "retrieval_count_norm",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureVector = Record<FeatureName, number>;

const SUPERLATIVES = /\b(expert|world-class|best|leading|pioneer|unmatched|exceptional|deep expertise)\b/i;
const SCOPE_VERBS = /\b(led|owned|architected|founded|headed|drove|spearheaded|managed)\b/i;

export interface FeatureInput {
  claim: ResumeClaim;
  retrievalScores: number[];
}

export function extractFeatures({ claim, retrievalScores }: FeatureInput): FeatureVector {
  const text = claim.text;
  const numbers = text.match(/\d[\d,.]*/g) ?? [];
  const largest = numbers.reduce((max, n) => Math.max(max, Number(n.replace(/,/g, "")) || 0), 0);
  const scores = retrievalScores.length > 0 ? retrievalScores : [0];

  return {
    has_number: numbers.length > 0 ? 1 : 0,
    has_large_number: largest >= 10 ? 1 : 0,
    has_superlative: SUPERLATIVES.test(text) ? 1 : 0,
    has_scope_verb: SCOPE_VERBS.test(text) ? 1 : 0,
    asserts_level: claim.assertedLevel ? 1 : 0,
    asserts_top_level: claim.assertedLevel === "expert" || claim.assertedLevel === "advanced" ? 1 : 0,
    is_achievement: claim.category === "achievement" ? 1 : 0,
    is_credential: claim.category === "credential" ? 1 : 0,
    word_count_norm: Math.min(1, text.split(/\s+/).length / 40),
    retrieval_max: Math.max(...scores),
    retrieval_mean: scores.reduce((a, b) => a + b, 0) / scores.length,
    retrieval_count_norm: Math.min(1, retrievalScores.length / 6),
  };
}
