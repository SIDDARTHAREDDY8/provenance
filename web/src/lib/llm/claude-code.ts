import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { LlmProvider, StructuredRequest } from "./provider";

const run = promisify(execFile);

/**
 * An empty working directory, created once per process.
 *
 * The CLI loads whatever project context it finds where it runs. Invoked inside
 * this repo it billed 86k cached input tokens per call for CLAUDE.md, settings
 * and MCP definitions that an adjudication call has no use for. Running from an
 * empty directory with settings and MCP servers switched off took the same call
 * from $0.69 to $0.06 — twelve times cheaper for identical output.
 */
const NEUTRAL_CWD = mkdtempSync(path.join(os.tmpdir(), "provenance-llm-"));

interface CliResult {
  is_error?: boolean;
  api_error_status?: number | null;
  result?: string;
  total_cost_usd?: number;
}

/** Running total for the capture script, so a run reports what it cost. */
export let claudeCodeSpendUsd = 0;

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
      // Nothing about the host environment should reach a hiring decision, and
      // every byte of it is billed on each call. See NEUTRAL_CWD.
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
    ];
    if (req.system) args.push("--append-system-prompt", req.system);

    // The nested CLI must not inherit the parent's Anthropic transport settings
    // or session token. When it does, it authenticates as the parent session
    // rather than from the CLI's own stored credentials and the API rejects it
    // with "401 Invalid bearer token" — which looks exactly like being logged
    // out, and is not.
    const env = { ...process.env };
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;

    let stdout: string;
    try {
      ({ stdout } = await run("claude", args, {
        env,
        cwd: NEUTRAL_CWD,
        maxBuffer: 16 * 1024 * 1024,
        timeout: 180_000,
      }));
    } catch (err) {
      // Echoing the failed command here means echoing the whole prompt, which
      // buries the one line that matters. Report the reason, not the argv.
      const message = err instanceof Error ? err.message : String(err);
      const reason = /ENOENT/.test(message)
        ? "the `claude` CLI is not on PATH"
        : message.split("\n")[0]?.slice(0, 160);
      throw new Error(`claude CLI could not run (${req.cacheKey}): ${reason}`);
    }

    const envelope = JSON.parse(stdout) as CliResult;
    claudeCodeSpendUsd += envelope.total_cost_usd ?? 0;

    if (envelope.api_error_status === 401) {
      throw new Error(
        `claude CLI got 401 for "${req.cacheKey}".\n` +
          "  The CLI's stored credentials were rejected. On machines where Claude Code is\n" +
          "  signed in through the desktop app, auth is brokered by that app and a bare\n" +
          "  shell invocation has nothing to refresh the token with.\n" +
          "  Fixes, in order of reliability:\n" +
          "    1. ANTHROPIC_API_KEY=sk-ant-... npm run capture\n" +
          "    2. run `claude` interactively once so it refreshes, then retry\n" +
          "  The committed fixtures are already real captured output, so this is only\n" +
          "  needed to re-record them.",
      );
    }
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
