import { AnthropicProvider } from "./anthropic";
import { FixtureProvider } from "./fixture";
import type { LlmProvider } from "./provider";

export type { ExtractionBatch, LlmProvider, RawClaim } from "./provider";
export { buildPrompt, CLAIM_TOOL_SCHEMA } from "./provider";

/**
 * Live model when a key is present, recorded fixtures otherwise. Everything
 * downstream — batching, canonicalisation, validation, scoring — is identical on
 * both paths, so the offline demo is not a different product.
 */
export function selectProvider(): LlmProvider {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key && key.trim().length > 0) return new AnthropicProvider(key);
  return new FixtureProvider();
}
