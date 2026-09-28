import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LlmProvider, StructuredRequest } from "./provider";

/**
 * Replays authored fixtures so the runtime, its retries, its checks and the
 * eval suite all run with no key and no network.
 *
 * These fixtures are HAND-AUTHORED, not captured model output. They are written
 * to include the failure modes a real extractor exhibits — fabricated quotes,
 * off-taxonomy skills, citations to documents that do not exist — so the
 * validation path is exercised on every run. Set ANTHROPIC_API_KEY to replace
 * this with a live model; nothing downstream changes.
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
