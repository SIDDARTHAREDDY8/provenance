import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LlmProvider, StructuredRequest } from "./provider";

/**
 * Wraps a live provider and writes every response to data/fixtures/<cacheKey>.json.
 *
 * This is how the repo gets genuine model output while still running offline for
 * anyone who clones it: capture once against a real model, commit what it said,
 * and the FixtureProvider replays exactly that. The captured file is the model's
 * answer verbatim — no editing, or the fixture stops being evidence of anything.
 */
export class RecordingProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;

  constructor(
    private readonly inner: LlmProvider,
    private readonly dir = path.join(process.cwd(), "data", "fixtures"),
  ) {
    this.name = `recording(${inner.name})`;
    this.model = inner.model;
  }

  get calls(): number {
    return this.inner.calls;
  }

  async structured<T>(req: StructuredRequest): Promise<T> {
    const result = await this.inner.structured<T>(req);
    const file = path.join(this.dir, `${req.cacheKey}.json`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(result, null, 2) + "\n", "utf8");
    return result;
  }
}
