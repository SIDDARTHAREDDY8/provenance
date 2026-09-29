import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LlmProvider, StructuredRequest } from "./provider";

const run = promisify(execFile);

interface CliResult {
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
}

/**
 * Claude Code in headless mode as the model provider.
 *
 * Uses the Claude Code CLI's own login rather than an API key, which makes this
 * the cheapest way to get genuine model output into the pipeline — useful for
 * capturing fixtures and for anyone who has a Claude subscription but no API
 * credit.
 *
 * Structured output is coaxed rather than enforced: the CLI has no tool_choice,
 * so the schema is embedded in the prompt and the reply is parsed defensively.
 * That is strictly weaker than the API path's forced tool use, which is why
 * AnthropicProvider stays the default whenever a key is present.
 *
 * Note it shells out per call, so a run costs a process spawn per claim. Fine
 * for capture, too slow to serve traffic.
 */
export class ClaudeCodeProvider implements LlmProvider {
  readonly name = "claude-code";
  readonly model: string;
  private _calls = 0;

  constructor(model = process.env.LLM_MODEL ?? "sonnet") {
    this.model = model;
  }

  get calls(): number {
    return this._calls;
  }

  async structured<T>(req: StructuredRequest): Promise<T> {
    this._calls += 1;

    const schema = JSON.stringify(req.tool.input_schema, null, 2);
    const prompt = `${req.prompt}

---
Return ONLY a JSON object matching this schema. No prose, no code fence, no explanation.

${schema}`;

    const args = [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--model",
      this.model,
      // No tools: this is a single judgement call, and a model that can read the
      // filesystem could answer from the fixtures instead of the evidence.
      "--disallowedTools",
      "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch",
    ];
    if (req.system) args.push("--append-system-prompt", req.system);

    // The nested CLI must not inherit this process's Anthropic transport
    // settings, or it authenticates as the parent session and is rejected.
    const env = { ...process.env };
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;

    let stdout: string;
    try {
      ({ stdout } = await run("claude", args, {
        env,
        maxBuffer: 16 * 1024 * 1024,
        timeout: 180_000,
      }));
    } catch (err) {
      throw new Error(
        `claude CLI failed for "${req.cacheKey}": ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
      );
    }

    const envelope = JSON.parse(stdout) as CliResult;
    if (envelope.is_error || typeof envelope.result !== "string") {
      throw new Error(`claude CLI error for "${req.cacheKey}": ${envelope.result ?? "no result"}`);
    }

    return extractJson<T>(envelope.result, req.cacheKey);
  }
}

/**
 * Without forced tool use the model sometimes wraps its JSON in a fence or a
 * sentence. Recovering the object is not optional politeness — a parse failure
 * here would fail the step and retry a paid call.
 */
export function extractJson<T>(text: string, context: string): T {
  const trimmed = text.trim();
  const candidates = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }
  throw new Error(`Could not parse JSON from claude CLI for "${context}": ${trimmed.slice(0, 200)}`);
}
