import { promises as fs } from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';

const projectRoot = process.cwd();
const knowledgeBaseDir = path.join(projectRoot, 'docs', 'knowledge-base');
const sessionLogDir = path.join(projectRoot, 'data', 'session-logs');
const outputPath = path.join(projectRoot, 'data', 'rag', 'index.json');
const embeddingModel = process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error('Missing OPENAI_API_KEY.');
  process.exit(1);
}

const client = new OpenAI({ apiKey });

function normalizeText(input) {
  return input.replace(/\r\n/g, '\n').replace(/\t/g, ' ').replace(/[ ]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function stripMarkdown(input) {
  return normalizeText(
    input
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/[>*_~]/g, '')
  );
}

function createSnippet(input, maxLength = 220) {
  const text = normalizeText(input);
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength + 1);
  const boundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return `${cut.slice(0, boundary > 0 ? boundary : maxLength).trim()}...`;
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) {
    return { attributes: {}, body: markdown.trim() };
  }

  const end = markdown.indexOf('\n---\n', 4);
  if (end === -1) {
    return { attributes: {}, body: markdown.trim() };
  }

  const rawFrontmatter = markdown.slice(4, end).trim();
  const body = markdown.slice(end + 5).trim();
  const attributes = {};

  for (const line of rawFrontmatter.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    attributes[key] = value.startsWith('[') && value.endsWith(']')
      ? value.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean)
      : value;
  }

  return { attributes, body };
}

function splitMarkdownByHeadings(markdown) {
  const lines = markdown.split('\n');
  const sections = [];
  let currentHeading = null;
  let buffer = [];

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
  return sections.length > 0 ? sections : [{ heading: null, text: markdown.trim() }];
}

function findChunkEnd(text, start, maxEnd, targetEnd) {
  if (maxEnd >= text.length) return text.length;
  for (const marker of ['\n\n', '\n', '. ', '; ', ', ', ' ']) {
    const index = text.lastIndexOf(marker, maxEnd);
    if (index > start + Math.floor((targetEnd - start) * 0.6)) {
      return index + marker.length;
    }
  }
  return maxEnd;
}

function chunkText(input, { targetSize = 1100, maxSize = 1200, overlap = 150 } = {}) {
  const text = normalizeText(input);
  if (!text) return [];
  if (text.length <= maxSize) return [text];

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const targetEnd = Math.min(start + targetSize, text.length);
    const maxEnd = Math.min(start + maxSize, text.length);
    const end = findChunkEnd(text, start, maxEnd, targetEnd);
    const chunk = text.slice(start, end).trim();
    if (!chunk) break;
    chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function formatNested(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [`${pad}${value}`];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => formatNested(item, indent));
  }
  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) => {
      const nestedLines = formatNested(nested, indent + 2);
      if (nestedLines.length === 0) return [];
      if (nestedLines.length === 1) return [`${pad}${key}: ${nestedLines[0].trim()}`];
      return [`${pad}${key}:`, ...nestedLines];
    });
  }
  return [];
}

function formatSession(session) {
  return stripMarkdown([
    `Date: ${session.date}`,
    `Track: ${session.track}`,
    `Bike: ${session.bike}`,
    'Setup:',
    ...formatNested(session.setup, 2),
    'Conditions:',
    ...formatNested(session.conditions, 2),
    'Rider feedback:',
    ...session.rider_feedback.map((item) => `  - ${item}`),
    `Lap times: ${session.lap_times.join(', ')}`,
  ].join('\n'));
}

async function loadKnowledgeBaseChunks() {
  const entries = (await fs.readdir(knowledgeBaseDir)).filter((entry) => entry.endsWith('.md')).sort();
  const chunks = [];

  for (const entry of entries) {
    const filePath = path.join(knowledgeBaseDir, entry);
    const raw = await fs.readFile(filePath, 'utf8');
    const { attributes, body } = parseFrontmatter(raw);
    const id = typeof attributes.id === 'string' ? attributes.id : path.basename(entry, '.md');
    const title = typeof attributes.title === 'string' ? attributes.title : id;
    const tags = Array.isArray(attributes.tags) ? attributes.tags : [];
    const sections = splitMarkdownByHeadings(body);

    let chunkNumber = 0;
    for (const section of sections) {
      const sectionTitle = section.heading ? `${title}: ${section.heading}` : title;
      for (const text of chunkText(stripMarkdown(section.text))) {
        chunkNumber += 1;
        chunks.push({
          chunkId: `knowledge_base:${id}:${chunkNumber}`,
          sourceType: 'knowledge_base',
          sourceId: id,
          title: sectionTitle,
          path: path.relative(projectRoot, filePath),
          text,
          snippet: createSnippet(text),
          metadata: { tags },
        });
      }
    }
  }

  return chunks;
}

async function loadSessionChunks() {
  const entries = (await fs.readdir(sessionLogDir)).filter((entry) => entry.endsWith('.json')).sort();
  const chunks = [];

  for (const entry of entries) {
    const filePath = path.join(sessionLogDir, entry);
    const session = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const text = formatSession(session);
    const title = `${session.track} - ${session.bike} - ${session.date}`;
    const textChunks = chunkText(text);

    for (const [index, chunkTextValue] of textChunks.entries()) {
      chunks.push({
        chunkId: `session_log:${session.id}:${index + 1}`,
        sourceType: 'session_log',
        sourceId: session.id,
        title,
        path: path.relative(projectRoot, filePath),
        text: chunkTextValue,
        snippet: createSnippet(chunkTextValue),
        metadata: {
          track: session.track,
          bike: session.bike,
          date: session.date,
        },
      });
    }
  }

  return chunks;
}

async function main() {
  const knowledgeBaseChunks = await loadKnowledgeBaseChunks();
  const sessionChunks = await loadSessionChunks();
  const chunks = [...knowledgeBaseChunks, ...sessionChunks];

  if (chunks.length === 0) {
    throw new Error('No RAG chunks were generated.');
  }

  const embeddings = await client.embeddings.create({
    model: embeddingModel,
    input: chunks.map((chunk) => chunk.text),
  });

  const index = {
    version: 1,
    createdAt: new Date().toISOString(),
    embeddingModel,
    dimensions: embeddings.data[0]?.embedding.length ?? 0,
    chunks: chunks.map((chunk, index) => ({
      ...chunk,
      embedding: embeddings.data[index]?.embedding ?? [],
    })),
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

  console.log(`[rag:index] Wrote ${chunks.length} chunks to ${path.relative(projectRoot, outputPath)}`);
  console.log(`[rag:index] knowledge_base=${knowledgeBaseChunks.length} session_log=${sessionChunks.length}`);
}

main().catch((error) => {
  console.error(`[rag:index] ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exit(1);
});
