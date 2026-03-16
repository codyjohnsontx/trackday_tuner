import type { RagChunk, RagIndex, RagQueryFilters, RagRetrievedChunk } from '@/lib/rag/types';

const DEFAULT_SCORE_THRESHOLD = 0.2;
const DEFAULT_TOTAL_LIMIT = 8;
const DEFAULT_PER_SOURCE_LIMIT = 4;

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return vector;
  }
  return vector.map((value) => value / magnitude);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  const normalizedLeft = normalizeVector(left);
  const normalizedRight = normalizeVector(right);
  return normalizedLeft.reduce((sum, value, index) => sum + value * normalizedRight[index], 0);
}

function isSessionChunkAllowed(chunk: RagChunk, filters?: RagQueryFilters): boolean {
  if (chunk.sourceType !== 'session_log' || !filters) {
    return true;
  }

  const track = filters.track?.trim().toLowerCase();
  const bike = filters.bike?.trim().toLowerCase();
  const dateFrom = filters.dateFrom?.trim();
  const dateTo = filters.dateTo?.trim();

  if (track && chunk.metadata.track?.toLowerCase() !== track) {
    return false;
  }

  if (bike && chunk.metadata.bike?.toLowerCase() !== bike) {
    return false;
  }

  if (dateFrom && (chunk.metadata.date ?? '') < dateFrom) {
    return false;
  }

  if (dateTo && (chunk.metadata.date ?? '') > dateTo) {
    return false;
  }

  return true;
}

export function retrieveRelevantChunks(input: {
  index: RagIndex;
  queryEmbedding: number[];
  filters?: RagQueryFilters;
  threshold?: number;
  totalLimit?: number;
  perSourceLimit?: number;
}): RagRetrievedChunk[] {
  const threshold = input.threshold ?? DEFAULT_SCORE_THRESHOLD;
  const totalLimit = input.totalLimit ?? DEFAULT_TOTAL_LIMIT;
  const perSourceLimit = input.perSourceLimit ?? DEFAULT_PER_SOURCE_LIMIT;

  const ranked = input.index.chunks
    .filter((chunk) => isSessionChunkAllowed(chunk, input.filters))
    .map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(chunk.embedding, input.queryEmbedding),
    }))
    .filter((chunk) => chunk.score >= threshold)
    .sort((left, right) => right.score - left.score);

  const selected: RagRetrievedChunk[] = [];
  const selectedIds = new Set<string>();
  const counts = {
    knowledge_base: 0,
    session_log: 0,
  };

  for (const chunk of ranked) {
    if (selected.length >= totalLimit) {
      break;
    }
    if (counts[chunk.sourceType] >= perSourceLimit) {
      continue;
    }
    selected.push(chunk);
    selectedIds.add(chunk.chunkId);
    counts[chunk.sourceType] += 1;
  }

  if (selected.length < totalLimit) {
    for (const chunk of ranked) {
      if (selected.length >= totalLimit) {
        break;
      }
      if (selectedIds.has(chunk.chunkId)) {
        continue;
      }
      selected.push(chunk);
      selectedIds.add(chunk.chunkId);
    }
  }

  return selected;
}
