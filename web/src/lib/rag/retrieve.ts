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

export interface SearchOptions {
  /** MMR trade-off between relevance and diversity. */
  lambda?: number;
  /**
   * How many slots are reserved for the best-matching attested documents.
   * Set to 0 for pure similarity retrieval.
   */
  pinAttested?: number;
  /**
   * Include every attested document, regardless of similarity. Used for claims
   * where a third party is the natural authority — see the note on `search`.
   * Safe because attestations are few; it would need a cap on a real corpus.
   */
  includeAllAttested?: boolean;
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
   * Top-k with MMR, plus structured pre-filtering.
   *
   * MMR because a claim about one project will otherwise retrieve five chunks of
   * the same document, and corroboration from one source is weaker than from
   * three.
   *
   * Slots are reserved for attested evidence before ranking — see the note
   * inside the method.
   */
  async search(query: string, k = 6, options: SearchOptions = {}): Promise<Hit[]> {
    const { lambda = 0.72, pinAttested = 1, includeAllAttested = false } = options;
    const [q] = await this.embedder.embed([query]);
    if (!q) return [];

    const scored = this.vectors.map((v, i) => ({ i, score: cosine(q, v) }));
    scored.sort((a, b) => b.score - a.score);
    const pool = scored.slice(0, Math.max(k * 4, 20)).filter((s) => s.score > 0.01);

    // Attested evidence is included, not ranked.
    //
    // Reference checks and certificates are few, short, and written by someone
    // other than the candidate. Ranking them against thirty pull requests by
    // similarity buries them every time — and they are the only documents that
    // can independently contradict a claim. So for claims where a third party
    // is the natural authority, every attested document goes into context, and
    // similarity is left to fill the remaining slots.
    const pinned: { i: number; score: number }[] = [];
    if (includeAllAttested || pinAttested > 0) {
      const bestPerDoc = new Map<string, { i: number; score: number }>();
      for (const { i, score } of scored) {
        const chunk = this.chunks[i];
        const doc = chunk ? this.docs.get(chunk.docId) : undefined;
        if (!doc?.attested) continue;
        const current = bestPerDoc.get(doc.id);
        if (!current || score > current.score) bestPerDoc.set(doc.id, { i, score });
      }
      const ranked = [...bestPerDoc.values()].sort((a, b) => b.score - a.score);
      pinned.push(...(includeAllAttested ? ranked : ranked.slice(0, pinAttested)));

      const pinnedIdx = new Set(pinned.map((p) => p.i));
      for (let i = pool.length - 1; i >= 0; i--) {
        const entry = pool[i];
        if (entry && pinnedIdx.has(entry.i)) pool.splice(i, 1);
      }
    }

    const picked: typeof pool = [...pinned];
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

    return picked.slice(0, Math.max(k, pinned.length))
      .map(({ i, score }) => {
        const chunk = this.chunks[i];
        const doc = chunk ? this.docs.get(chunk.docId) : undefined;
        return chunk && doc ? { chunk, doc, score: Number(score.toFixed(4)) } : null;
      })
      .filter((h): h is Hit => h !== null);
  }
}
