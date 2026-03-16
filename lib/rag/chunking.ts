import type { LoadedKnowledgeBaseDoc, LoadedSessionLogDoc, RagChunk } from '@/lib/rag/types';

const DEFAULT_TARGET_SIZE = 1100;
const DEFAULT_MAX_SIZE = 1200;
const DEFAULT_OVERLAP = 150;
const DEFAULT_SNIPPET_LENGTH = 220;

interface ChunkTextOptions {
  targetSize?: number;
  maxSize?: number;
  overlap?: number;
}

interface ChunkSourceOptions extends ChunkTextOptions {
  sourceType: RagChunk['sourceType'];
  sourceId: string;
  title: string;
  path: string;
  metadata: RagChunk['metadata'];
}

interface MarkdownSection {
  heading: string | null;
  text: string;
}

interface FrontmatterResult {
  attributes: Record<string, string | string[]>;
  body: string;
}

export function normalizeText(input: string): string {
  return input.replace(/\r\n/g, '\n').replace(/\t/g, ' ').replace(/[ ]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function stripMarkdown(input: string): string {
  return normalizeText(
    input
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/[>*_~]/g, '')
  );
}

export function createSnippet(input: string, maxLength = DEFAULT_SNIPPET_LENGTH): string {
  const text = normalizeText(input);
  if (text.length <= maxLength) {
    return text;
  }

  const cut = text.slice(0, maxLength + 1);
  const boundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return `${cut.slice(0, boundary > 0 ? boundary : maxLength).trim()}...`;
}

export function parseFrontmatter(markdown: string): FrontmatterResult {
  if (!markdown.startsWith('---\n')) {
    return { attributes: {}, body: markdown.trim() };
  }

  const end = markdown.indexOf('\n---\n', 4);
  if (end === -1) {
    return { attributes: {}, body: markdown.trim() };
  }

  const rawFrontmatter = markdown.slice(4, end).trim();
  const body = markdown.slice(end + 5).trim();
  const attributes: Record<string, string | string[]> = {};

  for (const line of rawFrontmatter.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      attributes[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    } else {
      attributes[key] = value;
    }
  }

  return { attributes, body };
}

function splitMarkdownByHeadings(markdown: string): MarkdownSection[] {
  const lines = markdown.split('\n');
  const sections: MarkdownSection[] = [];
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) {
      sections.push({ heading: currentHeading, text });
    }
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^##+\s+(.*)$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1].trim();
      continue;
    }
    buffer.push(line);
  }

  flush();

  if (sections.length === 0) {
    return [{ heading: null, text: markdown.trim() }];
  }

  return sections;
}

function findChunkEnd(text: string, start: number, maxEnd: number, targetEnd: number): number {
  if (maxEnd >= text.length) {
    return text.length;
  }

  const preferredBreaks = ['\n\n', '\n', '. ', '; ', ', ', ' '];
  for (const marker of preferredBreaks) {
    const index = text.lastIndexOf(marker, maxEnd);
    if (index > start + Math.floor((targetEnd - start) * 0.6)) {
      return index + marker.length;
    }
  }

  return maxEnd;
}

export function chunkText(input: string, options: ChunkTextOptions = {}): string[] {
  const text = normalizeText(input);
  if (!text) {
    return [];
  }

  const targetSize = options.targetSize ?? DEFAULT_TARGET_SIZE;
  const maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;

  if (text.length <= maxSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const targetEnd = Math.min(start + targetSize, text.length);
    const maxEnd = Math.min(start + maxSize, text.length);
    const end = findChunkEnd(text, start, maxEnd, targetEnd);
    const chunk = text.slice(start, end).trim();

    if (!chunk) {
      break;
    }

    chunks.push(chunk);

    if (end >= text.length) {
      break;
    }

    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function chunkSourceText(text: string, options: ChunkSourceOptions): Omit<RagChunk, 'embedding'>[] {
  return chunkText(text, options).map((chunkTextValue, index) => ({
    chunkId: `${options.sourceType}:${options.sourceId}:${index + 1}`,
    sourceType: options.sourceType,
    sourceId: options.sourceId,
    title: options.title,
    path: options.path,
    text: chunkTextValue,
    snippet: createSnippet(chunkTextValue),
    metadata: options.metadata,
  }));
}

export function chunkKnowledgeBaseDoc(doc: LoadedKnowledgeBaseDoc): Omit<RagChunk, 'embedding'>[] {
  const sections = splitMarkdownByHeadings(doc.body);
  return sections.flatMap((section) => {
    const text = stripMarkdown(section.text);
    if (!text) {
      return [];
    }

    const title = section.heading ? `${doc.title}: ${section.heading}` : doc.title;
    return chunkSourceText(text, {
      sourceType: doc.sourceType,
      sourceId: doc.id,
      title,
      path: doc.path,
      metadata: { tags: doc.tags },
    });
  });
}

export function chunkSessionLogDoc(doc: LoadedSessionLogDoc): Omit<RagChunk, 'embedding'>[] {
  return chunkSourceText(doc.text, {
    sourceType: doc.sourceType,
    sourceId: doc.id,
    title: doc.title,
    path: doc.path,
    metadata: {
      track: doc.session.track,
      bike: doc.session.bike,
      date: doc.session.date,
    },
  });
}
