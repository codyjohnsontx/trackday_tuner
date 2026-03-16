import { describe, expect, it } from 'vitest';
import { buildCitations } from '@/lib/rag/citations';
import { cosineSimilarity, retrieveRelevantChunks } from '@/lib/rag/retrieval';
import type { RagIndex, RagRetrievedChunk } from '@/lib/rag/types';

const index: RagIndex = {
  version: 1,
  createdAt: '2026-03-03T00:00:00.000Z',
  embeddingModel: 'test-model',
  dimensions: 3,
  chunks: [
    {
      chunkId: 'knowledge_base:kb-1:1',
      sourceType: 'knowledge_base',
      sourceId: 'kb-1',
      title: 'Sag Basics',
      path: 'docs/knowledge-base/sag-basics.md',
      text: 'Rider sag is L0 minus L2.',
      snippet: 'Rider sag is L0 minus L2.',
      embedding: [1, 0, 0],
      metadata: { tags: ['sag'] },
    },
    {
      chunkId: 'session_log:s1:1',
      sourceType: 'session_log',
      sourceId: 's1',
      title: 'Road America - R6',
      path: 'data/session-logs/s1.json',
      text: 'Rear ride height improved mid-corner support.',
      snippet: 'Rear ride height improved mid-corner support.',
      embedding: [0.9, 0.1, 0],
      metadata: { track: 'Road America', bike: 'Yamaha R6', date: '2025-08-20' },
    },
    {
      chunkId: 'session_log:s2:1',
      sourceType: 'session_log',
      sourceId: 's2',
      title: 'Mid-Ohio - BRZ',
      path: 'data/session-logs/s2.json',
      text: 'Front pressure reduction improved turn-in.',
      snippet: 'Front pressure reduction improved turn-in.',
      embedding: [0, 1, 0],
      metadata: { track: 'Mid-Ohio', bike: 'Subaru BRZ', date: '2025-09-12' },
    },
  ],
};

describe('rag retrieval', () => {
  it('computes cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 5);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('ranks highest scoring chunks first', () => {
    const results = retrieveRelevantChunks({
      index,
      queryEmbedding: [1, 0, 0],
      threshold: 0.1,
      totalLimit: 3,
    });

    expect(results[0]?.chunkId).toBe('knowledge_base:kb-1:1');
    expect(results[1]?.chunkId).toBe('session_log:s1:1');
  });

  it('applies session filters without excluding knowledge-base results', () => {
    const results = retrieveRelevantChunks({
      index,
      queryEmbedding: [0.9, 0.1, 0],
      threshold: 0.1,
      filters: {
        track: 'Road America',
        bike: 'Yamaha R6',
        dateFrom: '2025-08-01',
        dateTo: '2025-08-31',
      },
    });

    expect(results.map((item) => item.chunkId)).toContain('knowledge_base:kb-1:1');
    expect(results.map((item) => item.chunkId)).toContain('session_log:s1:1');
    expect(results.map((item) => item.chunkId)).not.toContain('session_log:s2:1');
  });

  it('formats citations from used chunk ids', () => {
    const retrieved: RagRetrievedChunk[] = [
      {
        chunkId: 'session_log:s1:1',
        sourceType: 'session_log',
        sourceId: 's1',
        title: 'Road America - R6',
        path: 'data/session-logs/s1.json',
        text: 'Rear ride height improved mid-corner support.',
        snippet: 'Rear ride height improved mid-corner support.',
        score: 0.91,
        metadata: { track: 'Road America', bike: 'Yamaha R6', date: '2025-08-20' },
      },
      {
        chunkId: 'knowledge_base:kb-1:1',
        sourceType: 'knowledge_base',
        sourceId: 'kb-1',
        title: 'Sag Basics',
        path: 'docs/knowledge-base/sag-basics.md',
        text: 'Rider sag is L0 minus L2.',
        snippet: 'Rider sag is L0 minus L2.',
        score: 0.8,
        metadata: { tags: ['sag'] },
      },
    ];

    const citations = buildCitations(retrieved, ['knowledge_base:kb-1:1', 'missing', 'session_log:s1:1']);

    expect(citations).toHaveLength(2);
    expect(citations[0]?.source_id).toBe('s1');
    expect(citations[1]?.source_id).toBe('kb-1');
  });
});
