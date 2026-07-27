#!/usr/bin/env node
/**
 * Build-time gate for the RAG index.
 *
 * The Race Engineer reads `data/rag-index.json` from disk at request time with no
 * fallback, so a missing, zero-vector, or stale index does not degrade the feature
 * — it turns every call into a 500. Worse, `ai_requests` then records those as
 * errors, and the beta report counts a rider as "guided" only on a success status,
 * so an outage reads exactly like riders declining to use the AI.
 *
 * Failing the build is therefore strictly better than failing per request: a
 * broken index can never reach a deployment in the first place.
 */
import { promises as fs } from 'node:fs';
import {
  computeSourceHash,
  indexPath,
  INDEX_VERSION,
  kbDir,
  toRelPath,
  walkMarkdown,
} from './lib/rag-index-meta.mjs';

const REBUILD = 'Run `npm run rag:index` (with OPENAI_API_KEY set) and commit the result.';

function fail(message, hint = REBUILD) {
  console.error(`[rag:check] ${message}`);
  console.error(`[rag:check] ${hint}`);
  process.exit(1);
}

async function main() {
  const rel = toRelPath(indexPath);

  let raw;
  try {
    raw = await fs.readFile(indexPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      fail(
        `${rel} is missing. The Race Engineer would return 500 for every request in this build.`,
      );
    }
    throw err;
  }

  let index;
  try {
    index = JSON.parse(raw);
  } catch {
    fail(`${rel} is not valid JSON.`);
  }

  if (index.model === 'zero-vector') {
    fail(
      `${rel} holds zero-vector embeddings, so retrieval would return arbitrary chunks.`,
    );
  }

  if (index.version !== INDEX_VERSION) {
    fail(
      `${rel} is format version ${index.version ?? 'unknown'}; this build expects ${INDEX_VERSION}.`,
    );
  }

  const chunks = Array.isArray(index.chunks) ? index.chunks : [];
  if (chunks.length === 0) {
    fail(`${rel} contains no chunks.`);
  }

  if (!Number.isInteger(index.dimension) || index.dimension <= 0) {
    fail(`${rel} declares an invalid dimension: ${index.dimension}.`);
  }

  // Shape alone is not enough. A vector of NaN still has the right length, and an
  // all-zero vector scores identically against every query, so both would sail past
  // a length check and quietly return arbitrary chunks at request time. The
  // `model === 'zero-vector'` guard above only catches an index that admits to it.
  const mismatched = chunks.findIndex((chunk) => {
    if (!Array.isArray(chunk.embedding) || chunk.embedding.length !== index.dimension) {
      return true;
    }
    let sumSquares = 0;
    for (const value of chunk.embedding) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return true;
      sumSquares += value * value;
    }
    return sumSquares === 0;
  });
  if (mismatched !== -1) {
    fail(
      `${rel} chunk ${mismatched} (${chunks[mismatched]?.id ?? 'unknown'}) has an invalid embedding: expected ${index.dimension} finite numbers with a nonzero norm.`,
    );
  }

  const files = await walkMarkdown(kbDir);
  if (files.length === 0) {
    fail(`No markdown found in ${toRelPath(kbDir)}.`, 'Restore the knowledge base before building.');
  }

  const sourceHash = await computeSourceHash(files);
  if (!index.source_hash) {
    fail(`${rel} predates source hashing, so staleness cannot be verified.`);
  }
  if (index.source_hash !== sourceHash) {
    fail(
      `${rel} is stale: it was built from a different knowledge base than the one in this tree.`,
    );
  }

  console.log(
    `[rag:check] ok - ${chunks.length} chunks, dim ${index.dimension}, model ${index.model}, ${files.length} source docs.`,
  );
}

main().catch((err) => {
  console.error('[rag:check]', err);
  process.exit(1);
});
