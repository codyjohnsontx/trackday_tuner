import type { KnowledgeChunk, RetrievedChunk } from '@/lib/rag/types';
import type { VehicleType } from '@/types';

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export interface RetrieveOptions {
  vehicleType?: VehicleType;
  topK?: number;
  maxK?: number;
  duplicateThreshold?: number;
}

export const DEFAULT_TOP_K = 4;
export const MAX_TOP_K = 8;
export const DEFAULT_DUPLICATE_THRESHOLD = 0.92;

export interface RetrievalInput {
  queryEmbedding: number[];
  chunks: KnowledgeChunk[];
}

export function scoreChunks(
  { queryEmbedding, chunks }: RetrievalInput,
  options: RetrieveOptions = {},
): RetrievedChunk[] {
  const vehicleType = options.vehicleType;
  const queryDim = queryEmbedding.length;
  const filtered = chunks.filter((c) => {
    if (c.embedding.length !== queryDim) return false;
    if (!vehicleType) return true;
    return c.vehicle_type === 'both' || c.vehicle_type === vehicleType;
  });
  return filtered
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score);
}

export function dedupeScored(
  scored: RetrievedChunk[],
  duplicateThreshold = DEFAULT_DUPLICATE_THRESHOLD,
): RetrievedChunk[] {
  const kept: RetrievedChunk[] = [];
  for (const candidate of scored) {
    const isDuplicate = kept.some((existing) => {
      if (
        existing.chunk.source === candidate.chunk.source &&
        existing.chunk.heading === candidate.chunk.heading
      ) {
        return true;
      }
      const sim = cosineSimilarity(existing.chunk.embedding, candidate.chunk.embedding);
      return sim >= duplicateThreshold;
    });
    if (!isDuplicate) kept.push(candidate);
  }
  return kept;
}

function sanitizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  return floored > 0 ? floored : fallback;
}

export function selectTopChunks(
  input: RetrievalInput,
  options: RetrieveOptions = {},
): RetrievedChunk[] {
  const maxK = sanitizePositiveInt(options.maxK, MAX_TOP_K);
  const requestedTopK = sanitizePositiveInt(options.topK, DEFAULT_TOP_K);
  const topK = Math.max(1, Math.min(requestedTopK, maxK));
  const scored = scoreChunks(input, options);
  const deduped = dedupeScored(scored, options.duplicateThreshold);
  return deduped.slice(0, topK);
}
