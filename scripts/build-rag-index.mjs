#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const kbDir = path.join(repoRoot, 'docs', 'knowledge-base');
const dataDir = path.join(repoRoot, 'data');
const outputPath = path.join(dataDir, 'rag-index.json');

const TARGET_TOKENS = 500;
const OVERLAP_TOKENS = 50;
// Rough heuristic used both here and in the retriever hot-path.
const CHARS_PER_TOKEN = 4;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

async function walkMarkdown(dir) {
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return results;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkMarkdown(full)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results.sort();
}

function parseFrontMatter(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== '---') {
    return { data: {}, body: raw };
  }
  const end = lines.indexOf('---', 1);
  if (end === -1) {
    return { data: {}, body: raw };
  }
  const data = {};
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  const body = lines.slice(end + 1).join('\n').trim();
  return { data, body };
}

function splitBySections(body) {
  const sections = [];
  const lines = body.split(/\r?\n/);
  let current = { heading: null, content: [] };
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+?)\s*$/);
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h1) {
      if (current.content.length > 0 || current.heading) sections.push(current);
      current = { heading: h1[1].trim(), content: [] };
      continue;
    }
    if (h2) {
      if (current.content.length > 0 || current.heading) sections.push(current);
      current = { heading: h2[1].trim(), content: [] };
      continue;
    }
    current.content.push(line);
  }
  if (current.content.length > 0 || current.heading) sections.push(current);
  return sections.filter((s) => s.heading || s.content.some((l) => l.trim()));
}

function splitLongText(text, maxChars, overlapChars) {
  const pieces = [];
  if (text.length <= maxChars) {
    pieces.push(text);
    return pieces;
  }
  // Split on paragraph boundaries, greedily filling up to maxChars.
  const paragraphs = text.split(/\n\s*\n/);
  let buffer = '';
  for (const para of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${para}` : para;
    if (candidate.length > maxChars && buffer) {
      pieces.push(buffer);
      const tail = buffer.slice(Math.max(0, buffer.length - overlapChars));
      buffer = `${tail}\n\n${para}`;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) pieces.push(buffer);
  return pieces;
}

function chunkDocument({ relPath, data, body }) {
  const vehicleType =
    data.vehicle_type === 'motorcycle' || data.vehicle_type === 'car'
      ? data.vehicle_type
      : 'both';
  const topic = data.topic ?? null;
  const summary = data.summary ?? null;

  const sections = splitBySections(body);
  const chunks = [];
  let counter = 0;
  for (const section of sections) {
    const heading = section.heading ?? 'Overview';
    const text = section.content.join('\n').trim();
    if (!text) continue;
    const pieces = splitLongText(text, TARGET_CHARS, OVERLAP_CHARS);
    for (const piece of pieces) {
      counter += 1;
      const id = `${relPath}#${counter.toString().padStart(2, '0')}`;
      chunks.push({
        id,
        source: relPath,
        heading,
        vehicle_type: vehicleType,
        topic,
        summary,
        text: piece.trim(),
      });
    }
  }
  return chunks;
}

async function embedBatch(client, model, texts) {
  const response = await client.embeddings.create({
    model,
    input: texts,
  });
  return response.data.map((item) => item.embedding);
}

const KNOWN_EMBEDDING_DIMENSIONS = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};
const FALLBACK_EMBEDDING_DIM = 1536;

function getEmbeddingDim(embeddingModel) {
  const known = KNOWN_EMBEDDING_DIMENSIONS[embeddingModel];
  if (known) return known;
  console.warn(
    `[rag:index] Unknown embedding model '${embeddingModel}'; using fallback dim ${FALLBACK_EMBEDDING_DIM}.`,
  );
  return FALLBACK_EMBEDDING_DIM;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  const embeddingModel = process.env.AI_EMBEDDING_MODEL ?? 'text-embedding-3-small';

  const files = await walkMarkdown(kbDir);
  if (files.length === 0) {
    console.error(`[rag:index] No markdown files found in ${path.relative(repoRoot, kbDir)}`);
    process.exit(1);
  }

  const allChunks = [];
  for (const absPath of files) {
    const relPath = path.relative(repoRoot, absPath).split(path.sep).join('/');
    const raw = await fs.readFile(absPath, 'utf8');
    const { data, body } = parseFrontMatter(raw);
    const chunks = chunkDocument({ relPath, data, body });
    allChunks.push(...chunks);
  }

  console.log(`[rag:index] Prepared ${allChunks.length} chunks from ${files.length} docs.`);

  let embeddings;
  if (!apiKey) {
    const zeroDim = getEmbeddingDim(embeddingModel);
    console.warn(
      `[rag:index] OPENAI_API_KEY not set; writing index with zero-vector embeddings (dim=${zeroDim}). ` +
        'Retrieval will return arbitrary results until the index is rebuilt with a real key.',
    );
    embeddings = allChunks.map(() => new Array(zeroDim).fill(0));
  } else {
    const client = new OpenAI({ apiKey });
    embeddings = [];
    const batchSize = 32;
    for (let i = 0; i < allChunks.length; i += batchSize) {
      const slice = allChunks.slice(i, i + batchSize);
      const inputs = slice.map(
        (chunk) => `${chunk.source}\n${chunk.heading}\n\n${chunk.text}`,
      );
      const batch = await embedBatch(client, embeddingModel, inputs);
      embeddings.push(...batch);
      console.log(
        `[rag:index] Embedded ${Math.min(i + batchSize, allChunks.length)}/${allChunks.length}`,
      );
    }
  }

  const chunks = allChunks.map((chunk, idx) => ({ ...chunk, embedding: embeddings[idx] }));
  const payload = {
    version: 1,
    model: apiKey ? embeddingModel : 'zero-vector',
    dimension: embeddings[0]?.length ?? 0,
    generated_at: new Date().toISOString(),
    chunks,
  };

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2));
  console.log(`[rag:index] Wrote ${chunks.length} chunks to ${path.relative(repoRoot, outputPath)}`);
}

main().catch((err) => {
  console.error('[rag:index]', err);
  process.exit(1);
});
