import { describe, expect, it } from 'vitest';
import { chunkKnowledgeBaseDoc, chunkText, createSnippet, parseFrontmatter } from '@/lib/rag/chunking';

describe('rag chunking', () => {
  it('parses lightweight frontmatter', () => {
    const parsed = parseFrontmatter(`---\nid: sample\ntitle: Sample\ntags: [one, two]\n---\n\nBody text`);

    expect(parsed.attributes.id).toBe('sample');
    expect(parsed.attributes.title).toBe('Sample');
    expect(parsed.attributes.tags).toEqual(['one', 'two']);
    expect(parsed.body).toBe('Body text');
  });

  it('splits long text with overlap', () => {
    const text = `Heading\n\n${'alpha '.repeat(500)}`;
    const chunks = chunkText(text, { maxSize: 300, targetSize: 240, overlap: 30 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].slice(-20)).toContain('alpha');
    expect(chunks[1].slice(0, 40)).toContain('alpha');
  });

  it('creates bounded snippets', () => {
    const snippet = createSnippet('word '.repeat(80), 40);
    expect(snippet.length).toBeLessThanOrEqual(43);
    expect(snippet.endsWith('...')).toBe(true);
  });

  it('keeps heading context in knowledge-base chunk titles', () => {
    const chunks = chunkKnowledgeBaseDoc({
      sourceType: 'knowledge_base',
      id: 'kb-1',
      title: 'Sag Basics',
      path: 'docs/knowledge-base/sag-basics.md',
      tags: ['sag'],
      body: '## Front\n\nMeasure L0 with the fork fully extended.\n\n## Rear\n\nSupport the bike so the rear is unweighted.',
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0].title).toBe('Sag Basics: Front');
    expect(chunks[1].title).toBe('Sag Basics: Rear');
  });
});
