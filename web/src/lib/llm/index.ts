import { AnthropicProvider } from "./anthropic";
import { ClaudeCodeProvider } from "./claude-code";
import { FixtureProvider } from "./fixture";
import type { LlmProvider } from "./provider";

export type { LlmProvider, StructuredRequest, ToolSchema } from "./provider";
export { ClaudeCodeProvider } from "./claude-code";
export { RecordingProvider } from "./recording";

/**
 * API key if present, then Claude Code's own login, then recorded fixtures.
 *
 * The API path is preferred because it can force tool use, which makes malformed
 * structured output impossible rather than merely unlikely. The CLI path exists
 * so that a Claude subscription is enough to run this for real.
 */
export function selectProvider(): LlmProvider {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key && key.trim().length > 0) return new AnthropicProvider(key);
  if (process.env.LLM_PROVIDER === "claude-code") return new ClaudeCodeProvider();
  return new FixtureProvider();
}
