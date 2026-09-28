import type { Artifact, ArtifactKind, Evidence, SkillLevel } from "@/lib/types";
import { levelFromValue, levelValue } from "@/lib/types";

/**
 * How much a single artifact can tell us about competence.
 *
 * A manager's written review and a design doc are deliberate statements about
 * ownership. A commit message is a side effect of doing the work and is often
 * one line. Weighting them equally is how you end up rating someone "advanced"
 * at Kubernetes because they once bumped a replica count.
 */
const KIND_WEIGHT: Record<ArtifactKind, number> = {
  review: 1.0,
  document: 0.9,
  pull_request: 0.8,
  ticket: 0.7,
  commit: 0.45,
};

export const CONFIDENCE_CEILING = 0.95;

export interface ConfidenceInput {
  evidence: Evidence[];
  artifactsById: Map<string, Artifact>;
  now?: Date;
}

export interface ConfidenceResult {
  confidence: number;
  thin: boolean;
  distinctArtifacts: number;
  distinctSources: number;
  /** Level ceiling implied by evidence quality, regardless of what the model claimed. */
  ceiling: SkillLevel;
}

export function scoreConfidence({ evidence, artifactsById, now = new Date() }: ConfidenceInput): ConfidenceResult {
  const artifacts = [...new Set(evidence.map((e) => e.artifactId))]
    .map((id) => artifactsById.get(id))
    .filter((a): a is Artifact => a !== undefined);

  const distinctArtifacts = artifacts.length;
  const distinctSources = new Set(artifacts.map((a) => a.source)).size;
  const weight = artifacts.reduce((sum, a) => sum + KIND_WEIGHT[a.kind], 0);

  // Saturating: the fifth corroborating artifact adds far less than the second.
  const base = 1 - Math.exp(-0.7 * weight);

  const latest = artifacts.reduce(
    (max, a) => Math.max(max, new Date(a.occurredAt).getTime()),
    0,
  );
  const monthsStale = latest === 0 ? 48 : (now.getTime() - latest) / (1000 * 60 * 60 * 24 * 30.4);
  // A skill last demonstrated three years ago is a weaker claim than the same
  // evidence from last month. Decays towards a floor rather than to zero.
  const recency = 0.75 + 0.25 * Math.exp(-monthsStale / 18);

  const sourceBonus = distinctSources >= 2 ? 0.08 : 0;
  // Ceiling of 0.95. Nothing inferred from text is certain, and a profile that
  // prints 1.00 next to a machine's guess is making a promise it cannot keep.
  const confidence = Math.min(CONFIDENCE_CEILING, Math.max(0, base * recency + sourceBonus));

  let ceiling: SkillLevel = "expert";
  if (distinctArtifacts <= 1) ceiling = weight >= 0.8 ? "intermediate" : "beginner";
  else if (weight < 1.6) ceiling = "intermediate";
  else if (weight < 2.6) ceiling = "advanced";

  return {
    confidence: Number(confidence.toFixed(2)),
    thin: distinctArtifacts < 2 || confidence < 0.45,
    distinctArtifacts,
    distinctSources,
    ceiling,
  };
}

/** Never report a level the evidence cannot carry, even if the model asserted it. */
export function capLevel(claimed: SkillLevel, ceiling: SkillLevel): SkillLevel {
  return levelFromValue(Math.min(levelValue(claimed), levelValue(ceiling)));
}
