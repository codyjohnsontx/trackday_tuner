import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  dedupeScored,
  scoreChunks,
  selectTopChunks,
} from '@/lib/rag/retriever-core';
import type { KnowledgeChunk } from '@/lib/rag/types';

function chunk(
  id: string,
  embedding: number[],
  overrides: Partial<KnowledgeChunk> = {},
): KnowledgeChunk {
  return {
    id,
    source: overrides.source ?? `docs/knowledge-base/${id}.md`,
    heading: overrides.heading ?? `Heading ${id}`,
    vehicle_type: overrides.vehicle_type ?? 'both',
    topic: overrides.topic ?? null,
    summary: overrides.summary ?? null,
    text: overrides.text ?? `text for ${id}`,
    embedding,
  };
}

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 10);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it('handles negative correlation', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });
});

describe('scoreChunks', () => {
  const chunks = [
    chunk('a', [1, 0, 0], { vehicle_type: 'motorcycle' }),
    chunk('b', [0.9, 0.1, 0], { vehicle_type: 'both' }),
    chunk('c', [0, 1, 0], { vehicle_type: 'car' }),
  ];

  it('ranks chunks by cosine similarity', () => {
    const ranked = scoreChunks({ queryEmbedding: [1, 0, 0], chunks });
    expect(ranked[0].chunk.id).toBe('a');
    expect(ranked[1].chunk.id).toBe('b');
    expect(ranked[2].chunk.id).toBe('c');
  });

  it('filters by vehicle type, keeping both', () => {
    const ranked = scoreChunks({ queryEmbedding: [1, 0, 0], chunks }, { vehicleType: 'motorcycle' });
    expect(ranked.map((r) => r.chunk.id)).toEqual(['a', 'b']);
  });

  it('filters to car vehicle type', () => {
    const ranked = scoreChunks({ queryEmbedding: [0, 1, 0], chunks }, { vehicleType: 'car' });
    expect(ranked.map((r) => r.chunk.id)).toEqual(['c', 'b']);
  });
});

describe('dedupeScored', () => {
  it('removes chunks with the same source + heading', () => {
    const c1 = chunk('a', [1, 0, 0], { source: 'same.md', heading: 'H' });
    const c2 = chunk('b', [0.99, 0.01, 0], { source: 'same.md', heading: 'H' });
    const deduped = dedupeScored([
      { chunk: c1, score: 0.9 },
      { chunk: c2, score: 0.8 },
    ]);
    expect(deduped.map((r) => r.chunk.id)).toEqual(['a']);
  });

  it('removes chunks whose embeddings are nearly identical', () => {
    const c1 = chunk('a', [1, 0], { source: 'x.md', heading: 'H1' });
    const c2 = chunk('b', [0.999, 0.001], { source: 'y.md', heading: 'H2' });
    const deduped = dedupeScored([
      { chunk: c1, score: 0.9 },
      { chunk: c2, score: 0.88 },
    ]);
    expect(deduped.map((r) => r.chunk.id)).toEqual(['a']);
  });

  it('keeps distinct-enough chunks', () => {
    const c1 = chunk('a', [1, 0], { source: 'x.md', heading: 'H1' });
    const c2 = chunk('b', [0, 1], { source: 'y.md', heading: 'H2' });
    const deduped = dedupeScored([
      { chunk: c1, score: 0.9 },
      { chunk: c2, score: 0.8 },
    ]);
    expect(deduped.map((r) => r.chunk.id)).toEqual(['a', 'b']);
  });
});

describe('selectTopChunks', () => {
  const chunks = [
    chunk('a', [1, 0, 0], { vehicle_type: 'motorcycle' }),
    chunk('b', [0.8, 0.2, 0], { vehicle_type: 'both' }),
    chunk('c', [0.5, 0.5, 0], { vehicle_type: 'motorcycle' }),
    chunk('d', [0, 1, 0], { vehicle_type: 'car' }),
    chunk('e', [0, 0, 1], { vehicle_type: 'motorcycle' }),
  ];

  it('respects topK and vehicle filter', () => {
    const result = selectTopChunks(
      { queryEmbedding: [1, 0, 0], chunks },
      { vehicleType: 'motorcycle', topK: 2 },
    );
    expect(result).toHaveLength(2);
    expect(result[0].chunk.id).toBe('a');
    expect(result[1].chunk.id).toBe('c');
  });

  it('caps topK at maxK', () => {
    const result = selectTopChunks(
      { queryEmbedding: [1, 0, 0], chunks },
      { topK: 10, maxK: 3 },
    );
    expect(result).toHaveLength(3);
  });
});
