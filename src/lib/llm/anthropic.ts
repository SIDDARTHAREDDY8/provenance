import {
  CLAIM_TOOL_SCHEMA,
  buildPrompt,
  type ExtractionBatch,
  type LlmProvider,
  type RawClaim,
} from "./provider";

const DEFAULT_MODEL = "claude-sonnet-5";

interface ToolUseBlock {
  type: "tool_use";
  name: string;
  input: { claims?: RawClaim[] };
}
type ContentBlock = ToolUseBlock | { type: string };

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, model = process.env.LLM_MODEL ?? DEFAULT_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
  }

  async extract(batch: ExtractionBatch): Promise<RawClaim[]> {
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 8192,
        // temperature 0: extraction is not a creative task, and a demo that
        // returns different skills on each run is impossible to evaluate.
        temperature: 0,
        tools: [CLAIM_TOOL_SCHEMA],
        tool_choice: { type: "tool", name: CLAIM_TOOL_SCHEMA.name },
        messages: [{ role: "user", content: buildPrompt(batch) }],
      }),
    });

    if (!res.ok) {
      throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }

    const body = (await res.json()) as { content?: ContentBlock[] };
    const toolUse = body.content?.find(
      (b): b is ToolUseBlock => b.type === "tool_use" && "name" in b && b.name === CLAIM_TOOL_SCHEMA.name,
    );
    return toolUse?.input.claims ?? [];
  }
}
