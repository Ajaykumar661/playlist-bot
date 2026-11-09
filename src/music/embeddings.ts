/**
 * Sentence embeddings for the rerank step (CPU, loaded once at startup).
 * If the model isn't loaded yet, or failed to load, rerank is skipped and the plain scores are used.
 */
import { resolve } from "node:path";
import { logger } from "../utils/logger.js";
import type { MatchingConfig } from "./matchingConfig.js";

type Extractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>;

let extractor: Extractor | null = null;
let loading: Promise<void> | null = null;

export function embeddingsReady(): boolean {
  return extractor !== null;
}

/** Start loading the model in the background. Safe to call more than once. */
export function initEmbeddings(cfg: MatchingConfig["rerank"]): Promise<void> {
  if (!cfg.enabled) {
    logger.info("Embedding rerank disabled in matching config");
    return Promise.resolve();
  }
  loading ??= (async () => {
    const started = Date.now();
    try {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = resolve(cfg.cacheDir);
      logger.info({ model: cfg.model, cacheDir: env.cacheDir }, "Loading embedding model (first run downloads ~120 MB)…");
      const pipe = await pipeline("feature-extraction", cfg.model, {
        device: "cpu",
        dtype: cfg.dtype as "q8",
      });
      extractor = pipe;
      logger.info(`Embedding model ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (error) {
      logger.error({ err: error }, "Could not load the embedding model. Matching works without rerank.");
    }
  })();
  return loading;
}

/** Cosine similarity of `query` against each text, or null if the model isn't available. */
export async function cosineSimilarities(query: string, texts: string[]): Promise<number[] | null> {
  if (!extractor || texts.length === 0) return null;
  try {
    const output = await extractor([query, ...texts], { pooling: "mean", normalize: true });
    const [q, ...rest] = output.tolist();
    if (!q) return null;
    // Vectors are normalized, so the dot product is the cosine.
    return rest.map((v) => v.reduce((sum, x, i) => sum + x * (q[i] ?? 0), 0));
  } catch (error) {
    logger.warn({ err: error }, "Embedding failed, skipping rerank");
    return null;
  }
}
