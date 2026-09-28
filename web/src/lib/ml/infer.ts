import { readFile } from "node:fs/promises";
import path from "node:path";
import { FEATURE_NAMES, FEATURE_VERSION, type FeatureVector } from "./features";

/**
 * Inference for models trained in Python.
 *
 * Training lives in ml/ (scikit-learn, proper train/test split, reported
 * metrics); serving is these twenty lines, because a logistic regression is a
 * dot product and standing up a model server to compute one would be silly.
 * The trainer exports coefficients to data/models/*.json and this reads them.
 * If the weights are missing the caller gets null and the UI says the model is
 * unavailable, rather than silently falling back to a made-up number.
 */

export interface LinearModel {
  name: string;
  featureVersion: number;
  features: string[];
  coefficients: number[];
  intercept: number;
  trainedAt: string;
  metrics: Record<string, number>;
}

const cache = new Map<string, LinearModel | null>();

export async function loadModel(name: string): Promise<LinearModel | null> {
  if (cache.has(name)) return cache.get(name) ?? null;
  try {
    const file = path.join(process.cwd(), "data", "models", `${name}.json`);
    const model = JSON.parse(await readFile(file, "utf8")) as LinearModel;
    if (model.featureVersion !== FEATURE_VERSION) {
      // Refusing a stale model is the whole point of versioning the features.
      console.warn(
        `[ml] ${name} was trained on feature version ${model.featureVersion}, runtime is ${FEATURE_VERSION} — ignoring`,
      );
      cache.set(name, null);
      return null;
    }
    cache.set(name, model);
    return model;
  } catch {
    cache.set(name, null);
    return null;
  }
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function score(model: LinearModel, features: Record<string, number>): number {
  let z = model.intercept;
  model.features.forEach((name, i) => {
    z += (model.coefficients[i] ?? 0) * (features[name] ?? 0);
  });
  return Number(sigmoid(z).toFixed(4));
}

/** Probability a claim will fail verification. Used to order work, never to decide. */
export async function claimRisk(features: FeatureVector): Promise<number | null> {
  const model = await loadModel("claim_risk");
  if (!model) return null;
  return score(model, features);
}

export interface RankFeatures {
  verified_score: number;
  claimed_score: number;
  inflation: number;
  blockers: number;
  contradicted: number;
  attested_ratio: number;
  distinct_sources_norm: number;
}

/**
 * Review-order score. Explicitly not a decision: the adjudicator never reads it.
 * It decides which of forty applications a human looks at first, which is a
 * scheduling problem, not an adverse action.
 */
export async function reviewPriority(features: RankFeatures): Promise<number | null> {
  const model = await loadModel("review_ranker");
  if (!model) return null;
  return score(model, features as unknown as Record<string, number>);
}

export { FEATURE_NAMES };
