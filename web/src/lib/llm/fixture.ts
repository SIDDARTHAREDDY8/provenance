import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LlmProvider, StructuredRequest } from "./provider";

/**
 * Replays captured model output so the runtime, its retries, its checks and the
 * eval suite all run with no key and no network.
 *
 * These fixtures are REAL responses, captured by `npm run capture` and committed
 * verbatim. Nothing in them is edited — an edited fixture stops being evidence
 * of anything. The capture script replays what it wrote and fails if any verdict
 * differs, so what ships here is exactly what the model said.
 *
 * The citation validator is therefore exercised by an adversarial probe in the
 * eval rather than by a planted fabrication: with honest captured output, "zero
 * rejections" would say nothing about whether the gate works.
 */
export class FixtureProvider implements LlmProvider {
  readonly name = "fixture";
  readonly model = "authored-fixtures";
  private _calls = 0;
  private cache = new Map<string, unknown>();

  get calls(): number {
    return this._calls;
  }

  async structured<T>(req: StructuredRequest): Promise<T> {
    this._calls += 1;
    const cached = this.cache.get(req.cacheKey);
    if (cached) return cached as T;

    const file = path.join(process.cwd(), "data", "fixtures", `${req.cacheKey}.json`);
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as T;
      this.cache.set(req.cacheKey, parsed);
      return parsed;
    } catch {
      throw new Error(
        `No fixture for "${req.cacheKey}". Add data/fixtures/${req.cacheKey}.json or set ANTHROPIC_API_KEY.`,
      );
    }
  }
}
