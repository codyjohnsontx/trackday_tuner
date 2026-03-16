import { chunkKnowledgeBaseDoc, chunkSessionLogDoc } from '@/lib/rag/chunking';
import type { RagIndex } from '@/lib/rag/types';
import type { RagProvider } from '@/lib/rag/provider';
import { loadKnowledgeBaseDocs, loadSessionLogDocs } from '@/lib/rag/sources';

interface BuildRagIndexResult {
  index: RagIndex;
  counts: {
    knowledgeBaseDocs: number;
    knowledgeBaseChunks: number;
    sessionDocs: number;
    sessionChunks: number;
  };
}

export async function buildRagIndex(provider: RagProvider, embeddingModel: string): Promise<BuildRagIndexResult> {
  const [knowledgeBaseDocs, sessionDocs] = await Promise.all([
    loadKnowledgeBaseDocs(),
    loadSessionLogDocs(),
  ]);

  const knowledgeBaseChunks = knowledgeBaseDocs.flatMap((doc) => chunkKnowledgeBaseDoc(doc));
  const sessionChunks = sessionDocs.flatMap((doc) => chunkSessionLogDoc(doc));
  const chunks = [...knowledgeBaseChunks, ...sessionChunks];
  const embeddings = await provider.embedTexts(chunks.map((chunk) => chunk.text));
  const dimensions = embeddings[0]?.length ?? 0;

  const index: RagIndex = {
    version: 1,
    createdAt: new Date().toISOString(),
    embeddingModel,
    dimensions,
    chunks: chunks.map((chunk, index) => ({
      ...chunk,
      embedding: embeddings[index] ?? [],
    })),
  };

  return {
    index,
    counts: {
      knowledgeBaseDocs: knowledgeBaseDocs.length,
      knowledgeBaseChunks: knowledgeBaseChunks.length,
      sessionDocs: sessionDocs.length,
      sessionChunks: sessionChunks.length,
    },
  };
}
