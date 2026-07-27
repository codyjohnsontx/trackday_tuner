import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(__dirname, '..', '..');
export const kbDir = path.join(repoRoot, 'docs', 'knowledge-base');
export const dataDir = path.join(repoRoot, 'data');
export const indexPath = path.join(dataDir, 'rag-index.json');

/** Bump when the on-disk index layout changes in a way older readers cannot parse. */
export const INDEX_VERSION = 2;

/**
 * Embeddings are stored rounded to this many decimals. Cosine ranking is
 * unaffected at 1e-6 while the serialized index shrinks by roughly two thirds,
 * which matters because the index is committed and shipped in the deployment.
 */
export const EMBEDDING_DECIMALS = 6;

export function roundEmbedding(embedding) {
  const factor = 10 ** EMBEDDING_DECIMALS;
  return embedding.map((value) => Math.round(value * factor) / factor);
}

/** Recursively collect markdown files, sorted so the hash is stable across machines. */
export async function walkMarkdown(dir) {
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

/** Repo-relative, POSIX-separated path so hashes match across platforms. */
export function toRelPath(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

/**
 * Fingerprint of the knowledge base: every source path plus its bytes. Stored in
 * the index and re-checked at build time so an index can never silently drift
 * out of sync with the docs it was generated from.
 */
export async function computeSourceHash(files) {
  const hash = createHash('sha256');
  for (const absPath of files) {
    hash.update(toRelPath(absPath));
    hash.update('\0');
    hash.update(await fs.readFile(absPath));
    hash.update('\0');
  }
  return hash.digest('hex');
}
