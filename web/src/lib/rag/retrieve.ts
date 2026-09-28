import type { EvidenceDoc } from "@/lib/types";
import { LexicalEmbedder, cosine, type EmbeddingProvider } from "./embed";

/**
 * Retrieval over the candidate's evidence pack.
 *
 * Documents are chunked because a verdict needs a citable span, not a whole
 * design doc, and because embedding a 400-word document into one vector buries
 * the one sentence that matters.
 */

export interface Chunk {
  id: string;
  docId: string;
  text: string;
  /** Character offset in the source body, so a citation can be located exactly. */
  offset: number;
}

export interface Hit {
  chunk: Chunk;
  doc: EvidenceDoc;
  score: number;
}

const CHUNK_CHARS = 320;
const CHUNK_OVERLAP = 80;

export function chunkDoc(doc: EvidenceDoc): Chunk[] {
  const text = `${doc.title}\n${doc.body}`;
  if (text.length <= CHUNK_CHARS) return [{ id: `${doc.id}#0`, docId: doc.id, text, offset: 0 }];

  const chunks: Chunk[] = [];
  let start = 0;
  let n = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_CHARS);
    // Prefer a sentence boundary so chunks stay quotable.
    if (end < text.length) {
      const boundary = text.lastIndexOf(". ", end);
      if (boundary > start + CHUNK_CHARS / 2) end = boundary + 1;
    }
    chunks.push({ id: `${doc.id}#${n++}`, docId: doc.id, text: text.slice(start, end).trim(), offset: start });
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

export class EvidenceIndex {
  private chunks: Chunk[] = [];
  private vectors: Float32Array[] = [];
  private docs = new Map<string, EvidenceDoc>();

  private constructor(private readonly embedder: EmbeddingProvider) {}

  static async build(docs: EvidenceDoc[], embedder: EmbeddingProvider): Promise<EvidenceIndex> {
    const index = new EvidenceIndex(embedder);
    for (const doc of docs) {
      index.docs.set(doc.id, doc);
      index.chunks.push(...chunkDoc(doc));
    }
    // IDF has to be fitted on this corpus, not a global one, or rare-in-general
    // but common-here terms ("settlement") get over-weighted.
    if (embedder instanceof LexicalEmbedder) embedder.fit(index.chunks.map((c) => c.text));
    index.vectors = await embedder.embed(index.chunks.map((c) => c.text));
    return index;
  }

  get size(): number {
    return this.chunks.length;
  }

  get providerName(): string {
    return this.embedder.name;
  }

  /**
   * Top-k with MMR. A claim about one project will otherwise retrieve five
   * chunks of the same document, and corroboration from one source is weaker
   * than corroboration from three.
   */
  async search(query: string, k = 6, lambda = 0.72): Promise<Hit[]> {
    const [q] = await this.embedder.embed([query]);
    if (!q) return [];

    const scored = this.vectors.map((v, i) => ({ i, score: cosine(q, v) }));
    scored.sort((a, b) => b.score - a.score);
    const pool = scored.slice(0, Math.max(k * 4, 20)).filter((s) => s.score > 0.01);

    const picked: typeof pool = [];
    while (picked.length < k && pool.length > 0) {
      let bestIdx = 0;
      let best = -Infinity;
      for (let p = 0; p < pool.length; p++) {
        const cand = pool[p];
        if (!cand) continue;
        let maxSim = 0;
        for (const chosen of picked) {
          const a = this.vectors[cand.i];
          const b = this.vectors[chosen.i];
          if (a && b) maxSim = Math.max(maxSim, cosine(a, b));
        }
        const mmr = lambda * cand.score - (1 - lambda) * maxSim;
        if (mmr > best) {
          best = mmr;
          bestIdx = p;
        }
      }
      const [chosen] = pool.splice(bestIdx, 1);
      if (chosen) picked.push(chosen);
    }

    return picked
      .map(({ i, score }) => {
        const chunk = this.chunks[i];
        const doc = chunk ? this.docs.get(chunk.docId) : undefined;
        return chunk && doc ? { chunk, doc, score: Number(score.toFixed(4)) } : null;
      })
      .filter((h): h is Hit => h !== null);
  }
}
