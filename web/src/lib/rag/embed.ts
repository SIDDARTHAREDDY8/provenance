/**
 * Embeddings behind an interface, with a deterministic local default.
 *
 * The local embedder is lexical: hashed character and word n-grams, IDF
 * weighted, L2 normalised. It is not semantic and will not match paraphrase —
 * it is here so retrieval runs with no key, no network and no flake, and so the
 * rest of the pipeline can be evaluated deterministically. Swapping in a real
 * model is one class, and `EMBEDDING_PROVIDER=openai` already does it.
 */

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

const DIM = 512;

function hash(token: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % DIM;
}

function tokenise(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9+#._-]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1);

  const grams: string[] = [...words];
  for (let i = 0; i < words.length - 1; i++) grams.push(`${words[i]}_${words[i + 1]}`);
  return grams;
}

export class LexicalEmbedder implements EmbeddingProvider {
  readonly name = "local-lexical";
  readonly dimensions = DIM;

  /** Document frequency, fitted over the corpus so common terms stop dominating. */
  private df = new Map<string, number>();
  private docs = 0;

  fit(corpus: string[]): void {
    this.docs = corpus.length;
    for (const text of corpus) {
      for (const token of new Set(tokenise(text))) {
        this.df.set(token, (this.df.get(token) ?? 0) + 1);
      }
    }
  }

  private idf(token: string): number {
    if (this.docs === 0) return 1;
    return Math.log((this.docs + 1) / ((this.df.get(token) ?? 0) + 1)) + 1;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const vec = new Float32Array(DIM);
      const counts = new Map<string, number>();
      for (const token of tokenise(text)) counts.set(token, (counts.get(token) ?? 0) + 1);

      for (const [token, tf] of counts) {
        const weight = (1 + Math.log(tf)) * this.idf(token);
        // Two hashes per token halves collision damage at no real cost.
        const a = hash(token, 0);
        const b = hash(token, 1);
        vec[a] = (vec[a] ?? 0) + weight;
        vec[b] = (vec[b] ?? 0) + weight * 0.5;
      }

      let norm = 0;
      for (const v of vec) norm += v * v;
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < DIM; i++) vec[i] = (vec[i] ?? 0) / norm;
      return vec;
    });
  }
}

class OpenAiEmbedder implements EmbeddingProvider {
  readonly name = "openai";
  readonly dimensions = 1536;
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
  ) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`openai embeddings ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { data: { embedding: number[] }[] };
    return body.data.map((d) => Float32Array.from(d.embedding));
  }
}

export function selectEmbedder(): EmbeddingProvider {
  const key = process.env.OPENAI_API_KEY;
  if (process.env.EMBEDDING_PROVIDER === "openai" && key) return new OpenAiEmbedder(key);
  return new LexicalEmbedder();
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}
