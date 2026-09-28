import type { LlmProvider, StructuredRequest } from "./provider";

interface ToolUseBlock {
  type: "tool_use";
  name: string;
  input: unknown;
}

/**
 * Structured output via forced tool use.
 *
 * Forcing the tool rather than asking for JSON in prose removes the whole class
 * of "the model wrapped it in a code fence" parsing bugs, and temperature 0
 * keeps an extraction task from being a creative one — a pipeline that returns
 * different verdicts on the same evidence cannot be evaluated or defended.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly model: string;
  private _calls = 0;
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    model = process.env.LLM_MODEL ?? "claude-sonnet-5",
  ) {
    this.model = model;
    this.baseUrl = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
  }

  get calls(): number {
    return this._calls;
  }

  async structured<T>(req: StructuredRequest): Promise<T> {
    this._calls += 1;
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
        temperature: 0,
        ...(req.system ? { system: req.system } : {}),
        tools: [req.tool],
        tool_choice: { type: "tool", name: req.tool.name },
        messages: [{ role: "user", content: req.prompt }],
      }),
    });

    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { content?: ({ type: string } | ToolUseBlock)[] };
    const block = body.content?.find(
      (b): b is ToolUseBlock => b.type === "tool_use" && "name" in b && b.name === req.tool.name,
    );
    if (!block) throw new Error(`anthropic returned no ${req.tool.name} tool call`);
    return block.input as T;
  }
}
