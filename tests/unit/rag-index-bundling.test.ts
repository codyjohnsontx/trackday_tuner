import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig from '@/next.config';

/**
 * `data/rag-index.json` is read at request time through
 * `path.join(process.cwd(), 'data', ...)`, which Next's output file tracing
 * cannot follow statically. R3 (053c545) is what that costs: the file was
 * missing from the deployment, every Race Engineer call returned 500 for
 * roughly three months, and it was found by a manual audit.
 *
 * `outputFileTracingIncludes` is the fix, and its weakness is that it is keyed
 * per route while each serverless function is its own bundle. A new route that
 * reaches the retriever and is not listed there ships without the index and
 * fails exactly the way R3 did - including `/api/health`, whose whole job is to
 * notice that. So this walks the first-party import graph of every API route
 * and requires an entry for each one that can reach the retriever.
 */

const ROOT = path.resolve(__dirname, '../..');
const RETRIEVER = path.join(ROOT, 'lib/rag/retriever.ts');
const INDEX_ASSET = './data/rag-index.json';

const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = path.join(ROOT, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    // A bare specifier is a package. Nothing in node_modules reads the index
    // off this repo's disk, so the walk stops here.
    return null;
  }

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every first-party module the given entry file can reach. */
function importClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const resolved = resolveSpecifier(match[1], file);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

function findRouteFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findRouteFiles(full));
    else if (entry.name === 'route.ts' || entry.name === 'route.tsx') found.push(full);
  }
  return found;
}

/** `app/api/ai/day-plan/route.ts` -> `/api/ai/day-plan` */
function routePath(routeFile: string): string {
  return `/${path.relative(path.join(ROOT, 'app'), path.dirname(routeFile))}`;
}

/** The subset of glob syntax `outputFileTracingIncludes` keys actually use. */
function globMatches(pattern: string, value: string): boolean {
  const source = pattern
    .split('**')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('.*');
  return new RegExp(`^${source}$`).test(value);
}

const tracingIncludes = (nextConfig.outputFileTracingIncludes ?? {}) as Record<string, string[]>;

function tracesTheIndex(route: string): boolean {
  return Object.entries(tracingIncludes).some(
    ([pattern, assets]) => globMatches(pattern, route) && assets.includes(INDEX_ASSET),
  );
}

describe('RAG index bundling', () => {
  const routeFiles = findRouteFiles(path.join(ROOT, 'app/api'));

  it('finds the API routes to check', () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it('traces the index into every route that can reach the retriever', () => {
    const reaching = routeFiles
      .filter((file) => importClosure(file).has(RETRIEVER))
      .map(routePath)
      .sort();

    // If this is empty the walk broke rather than the config being fine.
    expect(reaching.length).toBeGreaterThan(0);

    const untraced = reaching.filter((route) => !tracesTheIndex(route));
    expect(untraced, `add these to outputFileTracingIncludes in next.config.ts`).toEqual([]);
  });

  it('covers /api/health, which is the route that reports the index missing', () => {
    expect(tracesTheIndex('/api/health')).toBe(true);
  });

  it('covers the AI routes', () => {
    expect(tracesTheIndex('/api/ai/tuning-advice')).toBe(true);
    expect(tracesTheIndex('/api/ai/day-plan')).toBe(true);
  });
});
