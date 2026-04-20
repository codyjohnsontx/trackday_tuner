import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { KnowledgeIndex, RetrievedChunk } from '@/lib/rag/types';
import {
  selectTopChunks,
  type RetrieveOptions,
} from '@/lib/rag/retriever-core';

export {
  cosineSimilarity,
  scoreChunks,
  dedupeScored,
  selectTopChunks,
} from '@/lib/rag/retriever-core';
export type { RetrieveOptions, RetrievalInput } from '@/lib/rag/retriever-core';

let cachedIndex: KnowledgeIndex | null = null;
let cachedIndexPromise: Promise<KnowledgeIndex> | null = null;

function getIndexPath(): string {
  return path.join(process.cwd(), 'data', 'rag-index.json');
}

export async function loadKnowledgeIndex(): Promise<KnowledgeIndex> {
  if (cachedIndex) return cachedIndex;
  if (cachedIndexPromise) return cachedIndexPromise;
  const promise = (async () => {
    try {
      const indexPath = getIndexPath();
      const raw = await fs.readFile(indexPath, 'utf8');
      const parsed = JSON.parse(raw) as KnowledgeIndex;
      cachedIndex = parsed;
      return parsed;
    } catch (err) {
      // Clear the cached promise so a transient failure does not permanently
      // poison subsequent calls.
      cachedIndex = null;
      cachedIndexPromise = null;
      throw err;
    }
  })();
  cachedIndexPromise = promise;
  return promise;
}

export function isKnowledgeIndexLoaded(): boolean {
  return cachedIndex !== null;
}

export function resetKnowledgeIndexCache(): void {
  cachedIndex = null;
  cachedIndexPromise = null;
}

export async function retrieveRelevantChunks(
  queryEmbedding: number[],
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const index = await loadKnowledgeIndex();
  return selectTopChunks({ queryEmbedding, chunks: index.chunks }, options);
}
