import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExtractionBatch, LlmProvider, RawClaim } from "./provider";

interface Recording {
  model: string;
  recordedAt: string;
  note: string;
  claimsByArtifact: Record<string, RawClaim[]>;
}

/**
 * Replays a recorded extraction so the app and the eval suite run with no API
 * key, deterministically. Recordings are keyed per artifact and merged for
 * whatever batch is asked for, so the fixture path exercises the same batching,
 * merging and validation code as a live model call.
 */
export class FixtureProvider implements LlmProvider {
  readonly name = "fixture";
  private recording: Recording | null = null;
  readonly model = "recorded/claude-sonnet-5";

  private async load(): Promise<Recording> {
    if (this.recording) return this.recording;
    const file = path.join(process.cwd(), "data", "recorded", "extraction.json");
    this.recording = JSON.parse(await readFile(file, "utf8")) as Recording;
    return this.recording;
  }

  async extract(batch: ExtractionBatch): Promise<RawClaim[]> {
    const rec = await this.load();
    const out: RawClaim[] = [];
    for (const artifact of batch.artifacts) {
      out.push(...(rec.claimsByArtifact[artifact.id] ?? []));
    }
    return out;
  }
}
