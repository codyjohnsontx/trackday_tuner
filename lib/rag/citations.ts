import type { RagCitation, RagRetrievedChunk } from '@/lib/rag/types';

export function buildCitations(
  retrievedChunks: RagRetrievedChunk[],
  usedChunkIds: string[]
): RagCitation[] {
  const chunkMap = new Map(retrievedChunks.map((chunk) => [chunk.chunkId, chunk]));
  const seen = new Set<string>();

  return usedChunkIds
    .map((chunkId) => {
      if (seen.has(chunkId)) {
        return null;
      }
      seen.add(chunkId);
      return chunkMap.get(chunkId) ?? null;
    })
    .filter((chunk): chunk is RagRetrievedChunk => chunk !== null)
    .sort((left, right) => right.score - left.score)
    .map((chunk) => ({
      source_type: chunk.sourceType,
      source_id: chunk.sourceId,
      title: chunk.title,
      snippet: chunk.snippet,
      score: chunk.score,
    }));
}
