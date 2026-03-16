import { describe, expect, it, vi } from 'vitest';
import { RagIndexMissingError, RagValidationError, runRagQuery, validateRagQueryRequest } from '@/lib/rag/query';
import type { RagIndex } from '@/lib/rag/types';
import type { RagProvider } from '@/lib/rag/provider';

const index: RagIndex = {
  version: 1,
  createdAt: '2026-03-03T00:00:00.000Z',
  embeddingModel: 'test-model',
  dimensions: 2,
  chunks: [
    {
      chunkId: 'knowledge_base:kb-1:1',
      sourceType: 'knowledge_base',
      sourceId: 'kb-1',
      title: 'Sag Basics',
      path: 'docs/knowledge-base/sag-basics.md',
      text: 'Rider sag is the difference between L0 and L2.',
      snippet: 'Rider sag is the difference between L0 and L2.',
      embedding: [1, 0],
      metadata: { tags: ['sag'] },
    },
  ],
};

const provider: RagProvider = {
  embedTexts: vi.fn(async () => [[1, 0]]),
  generateAnswer: vi.fn(async () => ({
    answer: 'Rider sag is L0 minus L2.',
    usedChunkIds: ['knowledge_base:kb-1:1'],
    missingInfo: [],
  })),
};

describe('rag query validation', () => {
  it('rejects short questions', () => {
    expect(() => validateRagQueryRequest({ question: 'short' })).toThrow(RagValidationError);
  });

  it('rejects invalid dates and reversed ranges', () => {
    expect(() => validateRagQueryRequest({ question: 'valid enough', filters: { dateFrom: '03-03-2026' } })).toThrow(
      RagValidationError
    );
    expect(() =>
      validateRagQueryRequest({
        question: 'valid enough',
        filters: { dateFrom: '2026-03-03', dateTo: '2026-03-01' },
      })
    ).toThrow(RagValidationError);
  });
});

describe('runRagQuery', () => {
  it('throws when index is missing', async () => {
    await expect(runRagQuery({ question: 'What does rider sag mean?' }, { loadIndex: async () => null, provider })).rejects.toThrow(
      RagIndexMissingError
    );
  });

  it('returns refusal when no chunk passes threshold', async () => {
    const response = await runRagQuery(
      { question: 'What gearing should I use at Daytona?' },
      {
        loadIndex: async () => ({ ...index, chunks: [{ ...index.chunks[0], embedding: [0, 1] }] }),
        provider,
      }
    );

    expect(response.citations).toHaveLength(0);
    expect(response.answer).toContain("don't have enough grounded");
  });

  it('returns answer and citations when retrieval succeeds', async () => {
    const response = await runRagQuery(
      { question: 'What does rider sag mean?' },
      { loadIndex: async () => index, provider }
    );

    expect(response.answer).toBe('Rider sag is L0 minus L2.');
    expect(response.citations).toHaveLength(1);
    expect(response.citations[0]?.title).toBe('Sag Basics');
  });

  it('falls back to retrieved chunk ids when provider returns invalid ids', async () => {
    const fallbackProvider: RagProvider = {
      embedTexts: vi.fn(async () => [[1, 0]]),
      generateAnswer: vi.fn(async () => ({
        answer: '',
        usedChunkIds: ['missing'],
        missingInfo: [],
      })),
    };

    const response = await runRagQuery(
      { question: 'What does rider sag mean?' },
      { loadIndex: async () => index, provider: fallbackProvider }
    );

    expect(response.answer).toContain('could not produce a grounded answer');
    expect(response.citations).toHaveLength(1);
    expect(response.missing_info[0]).toContain('invalid or insufficiently grounded');
  });
});
