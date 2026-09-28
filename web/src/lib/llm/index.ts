import { AnthropicProvider } from "./anthropic";
import { FixtureProvider } from "./fixture";
import type { LlmProvider } from "./provider";

export type { LlmProvider, StructuredRequest, ToolSchema } from "./provider";

export function selectProvider(): LlmProvider {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key && key.trim().length > 0) return new AnthropicProvider(key);
  return new FixtureProvider();
}
