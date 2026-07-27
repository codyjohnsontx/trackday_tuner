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

export class ZeroVectorIndexError extends Error {
  constructor() {
    super(
      'RAG index contains only zero-vector embeddings; rebuild with OPENAI_API_KEY set before serving requests.',
    );
    this.name = 'ZeroVectorIndexError';
  }
}

export class MissingKnowledgeIndexError extends Error {
  constructor(indexPath: string) {
    super(
      `RAG index not found at ${indexPath}. It is committed to the repo and pulled into the ` +
        'serverless bundle by `outputFileTracingIncludes` in next.config.ts; if it is missing ' +
        'here, one of those two is broken. `npm run rag:check` only validates the copy in the ' +
        'repository, so it can pass while the file is still absent from a deployed bundle — ' +
        'if the repo copy is present, check the deployment output rather than rerunning it.',
    );
    this.name = 'MissingKnowledgeIndexError';
  }
}

export async function loadKnowledgeIndex(): Promise<KnowledgeIndex> {
  if (cachedIndex) return cachedIndex;
  if (cachedIndexPromise) return cachedIndexPromise;
  const promise = (async () => {
    const indexPath = getIndexPath();
    try {
      let raw: string;
      try {
        raw = await fs.readFile(indexPath, 'utf8');
      } catch (readErr) {
        if ((readErr as NodeJS.ErrnoException)?.code === 'ENOENT') {
          throw new MissingKnowledgeIndexError(indexPath);
        }
        throw readErr;
      }
      const parsed = JSON.parse(raw) as KnowledgeIndex;
      if (parsed.model === 'zero-vector') {
        throw new ZeroVectorIndexError();
      }
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
