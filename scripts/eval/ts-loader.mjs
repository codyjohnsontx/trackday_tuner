/**
 * ESM resolve hook that lets a plain node script import this project's
 * TypeScript modules directly, so the eval harness runs the SAME code the route
 * handler runs rather than a copy of it.
 *
 * Three things stand between node and `lib/rag/*.ts`, and this closes all three
 * without adding a build step or a dependency:
 *
 * - `@/...` is a tsconfig path alias node knows nothing about.
 * - TypeScript imports carry no file extension.
 * - `server-only` is a webpack alias Next resolves at build time; it is not an
 *   installed package, so importing `lib/rag/advice.ts` outside Next throws
 *   ERR_MODULE_NOT_FOUND before any of our code runs.
 *
 * Node >= 22.18 strips types from `.ts` on its own, which is why nothing here
 * transpiles. `format: 'module-typescript'` tells it to do that for a file it
 * reached through the alias branch, where the extension is no longer a hint.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SERVER_ONLY_STUB = pathToFileURL(path.join(import.meta.dirname, 'server-only-stub.mjs')).href;

// Every spelling an aliased import in this repository actually resolves to, and
// no more. Ordered: a directory's index file only wins when no sibling file
// matches. The resolver always APPENDS, so a specifier that already carries an
// extension is not served by adding that extension here.
const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '/index.ts'];

function tsFormatFor(filePath) {
  return filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'module-typescript' : undefined;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') {
    return { url: SERVER_ONLY_STUB, shortCircuit: true, format: 'module' };
  }

  if (specifier.startsWith('@/')) {
    const base = path.join(REPO_ROOT, specifier.slice(2));
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = base + suffix;
      if (existsSync(candidate)) {
        return {
          url: pathToFileURL(candidate).href,
          shortCircuit: true,
          format: tsFormatFor(candidate),
        };
      }
    }
    throw new Error(`[rag:eval] Cannot resolve path alias "${specifier}" under ${REPO_ROOT}`);
  }

  return nextResolve(specifier, context);
}
