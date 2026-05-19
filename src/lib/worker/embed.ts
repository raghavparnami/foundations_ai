/**
 * Thin wrapper around OpenAI's text-embedding-3-small.
 *
 * Why raw fetch (not @ai-sdk/openai or the openai SDK):
 *   - One endpoint, well-specified, ~30 lines. Avoids a new dep.
 *   - Env-gated: returns null cleanly when OPENAI_API_KEY is unset, so the
 *     rest of the catalog still works (lexical-only retrieval) until a key
 *     is provided.
 *   - Batches up to BATCH inputs per call. text-embedding-3-small accepts
 *     arrays — one network roundtrip per 100 inputs is the cost-optimal mode.
 *
 * Pricing (as of 2026-01): $0.02 / 1M tokens. 10K tables × ~500 tokens ≈ $0.10
 * cold backfill. Per-chat-turn query embed (~50 tokens) is ~$0.000001 — free.
 */
import { env } from "../shared/env";
import { log } from "../shared/log";

const MODEL = "text-embedding-3-small";
const DIM = 1536;
const BATCH = 96;            // OpenAI accepts up to 2048 inputs but ~100 is the latency sweet spot
const ENDPOINT = "https://api.openai.com/v1/embeddings";

export function embeddingsEnabled(): boolean {
  return Boolean(env().OPENAI_API_KEY);
}

export const EMBEDDING_DIM = DIM;

/**
 * Embed one string. Returns null if no key is configured.
 * Use embedMany for >1 input — batching is cheaper.
 */
export async function embedOne(text: string): Promise<number[] | null> {
  const arr = await embedMany([text]);
  return arr?.[0] ?? null;
}

/**
 * Embed an array of strings. Returns null if no key is configured.
 * Output is parallel-indexed to the input array.
 */
export async function embedMany(texts: string[]): Promise<number[][] | null> {
  const key = env().OPENAI_API_KEY;
  if (!key) return null;
  if (texts.length === 0) return [];

  const out: number[][] = new Array(texts.length);
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const vecs = await callBatch(key, slice);
    for (let j = 0; j < vecs.length; j++) {
      out[i + j] = vecs[j]!;
    }
  }
  return out;
}

async function callBatch(key: string, inputs: string[]): Promise<number[][]> {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model: MODEL, input: inputs }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data: { index: number; embedding: number[] }[];
    usage?: { prompt_tokens?: number; total_tokens?: number };
  };
  // OpenAI guarantees the response array order, but we sort by index to be safe
  // against intermediate proxies that may reorder.
  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  log.info("embed.batch", {
    n: inputs.length,
    tokens: json.usage?.total_tokens ?? 0,
    ms: Date.now() - t0,
  });
  return sorted.map((d) => d.embedding);
}

/**
 * Format a pgvector literal: `[0.1,0.2,...]`. pg's parameter binding stringifies
 * arrays with curly braces by default, which pgvector rejects.
 */
export function toPgVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
