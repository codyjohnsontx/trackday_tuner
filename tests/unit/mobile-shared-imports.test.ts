import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The phone app in `mobile/` imports website modules through `@/lib` and
 * `@/types`, and Metro bundles whatever those modules import in turn. `lib/` is
 * edited daily for the website, so a shared module growing a Next, React DOM or
 * server-only import would break the app at bundle time with nothing on the
 * website side noticing. This walks every shared import under `mobile/` through
 * the first-party graph and fails naming the module that reaches something the
 * app cannot load - the same shape as `rag-index-bundling.test.ts`.
 *
 * A shared import is an `@/lib` or `@/types` import, or a relative import that
 * climbs out of `mobile/`, since `../../lib/x` reaches the same module and would
 * otherwise walk past the guard. Both are handled alike: one that resolves is
 * followed, and one that does not is skipped, because Metro already fails an
 * import it cannot resolve.
 *
 * The app's own files are checked too, but only for the packages that exist
 * solely in the website's runtime: `next`, `server-only` and `@supabase/ssr`.
 * `react` is allowed because the app runs on it, and `react-dom` because the
 * Expo web build depends on it through `react-native-web`.
 *
 * Shared modules are also refused Node modules that cannot run under Metro: any
 * `node:` import, and the bare `fs`, `child_process`, `net`, `tls`, `dgram`,
 * `cluster`, `worker_threads`, `http2` and `crypto` with their subpaths. Other
 * bare built-in names such as `buffer`, `events`, `url`, `util` and `path` are
 * allowed, because each has an npm stand-in the app can bundle in its place.
 *
 * Until `mobile/` exists there is nothing to walk and it passes. The fixtures
 * under `tests/fixtures/mobile-shared-imports/` are what show it can fail.
 */

const ROOT = path.resolve(__dirname, '../..');
const FIXTURES = path.join(ROOT, 'tests/fixtures/mobile-shared-imports');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'web-build', 'android', 'ios']);

/** Packages that only exist in the website's runtime. */
const FORBIDDEN_PACKAGES = ['next', 'server-only', 'react', 'react-dom', '@supabase/ssr'];

/** What the app's own files may not import: the packages the app has no use for at all. */
const FORBIDDEN_APP_PACKAGES = ['next', 'server-only', '@supabase/ssr'];

/** Bare Node modules with no npm stand-in Metro could bundle instead. */
const UNBUNDLABLE_NODE_MODULES = [
  'fs',
  'child_process',
  'net',
  'tls',
  'dgram',
  'cluster',
  'worker_threads',
  'http2',
  'crypto',
];

/**
 * First-party modules that are server or Next code by definition: cookie and
 * admin clients, server env, the cookie-reading auth helper, server actions and
 * the Sentry-backed monitoring. `lib/auth.ts` is the file only - `lib/auth/`
 * holds `messages.ts`, which the app is meant to share.
 */
const FORBIDDEN_MODULES: { label: string; matches: (relative: string) => boolean }[] = [
  { label: 'lib/supabase/*', matches: (relative) => relative.startsWith('lib/supabase/') },
  { label: 'lib/env.server', matches: (relative) => relative === 'lib/env.server.ts' },
  { label: 'lib/auth.ts', matches: (relative) => relative === 'lib/auth.ts' },
  { label: 'lib/actions/*', matches: (relative) => relative.startsWith('lib/actions/') },
  { label: 'lib/monitoring/*', matches: (relative) => relative.startsWith('lib/monitoring/') },
];

interface Violation {
  /** The shared module at fault, relative to the root. */
  module: string;
  reason: string;
  /** How the app reached it, from the `mobile/` file inwards. */
  chain: string[];
}

function isPackage(specifier: string, names: readonly string[]): boolean {
  return names.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

/** `node:crypto`, `crypto`, `fs/promises`: Node modules the app cannot run. */
function isUnbundlableNodeModule(specifier: string): boolean {
  return specifier.startsWith('node:') || isPackage(specifier, UNBUNDLABLE_NODE_MODULES);
}

function resolveSpecifier(root: string, specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = path.join(root, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
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

function findSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findSourceFiles(full));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) found.push(full);
  }
  return found;
}

function specifiersOf(source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map((imported) => imported.fileName);
}

function prologueDirectives(statements: ts.NodeArray<ts.Statement>): string[] {
  const directives: string[] = [];
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    directives.push(statement.expression.text);
  }
  return directives;
}

/**
 * Why the file's directives rule it out, if they do: a `"use server"` or
 * `"use client"` prologue on the file, or a `"use server"` prologue on a function
 * body, which Next also reads as a server function.
 */
function directiveViolationOf(file: string, source: string): string | null {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest);
  const fileDirective = prologueDirectives(sourceFile.statements).find(
    (text) => text === 'use server' || text === 'use client',
  );
  if (fileDirective) return `has a "${fileDirective}" directive`;

  let inFunction = false;
  const visit = (node: ts.Node): void => {
    if (inFunction) return;
    if (ts.isFunctionLike(node) && 'body' in node && node.body && ts.isBlock(node.body)) {
      inFunction = prologueDirectives(node.body.statements).includes('use server');
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return inFunction ? 'has a function-level "use server" directive' : null;
}

/** Every shared module the app under `<root>/mobile` reaches that the app cannot load. */
function findMobileSharedImportViolations(root: string): Violation[] {
  const mobileRoot = path.join(root, 'mobile');
  if (!existsSync(mobileRoot)) return [];

  const relative = (file: string) => path.relative(root, file).split(path.sep).join('/');
  const insideMobile = (file: string) => !path.relative(mobileRoot, file).startsWith('..');
  const violations: Violation[] = [];
  const chains = new Map<string, string[]>();
  const queue: string[] = [];

  for (const appFile of findSourceFiles(mobileRoot)) {
    for (const specifier of specifiersOf(readFileSync(appFile, 'utf8'))) {
      if (isPackage(specifier, FORBIDDEN_APP_PACKAGES)) {
        violations.push({ module: relative(appFile), reason: `imports ${specifier}`, chain: [relative(appFile)] });
        continue;
      }
      // `@/lib` and `@/types` are the two aliases Metro maps to the repository
      // root. Any other `@/` is the app's own business, and a relative import only
      // counts once it climbs out of mobile/.
      const aliased = specifier.startsWith('@/lib/') || specifier.startsWith('@/types/') || specifier === '@/types';
      if (!aliased && !specifier.startsWith('.')) continue;
      const resolved = resolveSpecifier(root, specifier, appFile);
      if (!resolved || insideMobile(resolved) || chains.has(resolved)) continue;
      chains.set(resolved, [relative(appFile), relative(resolved)]);
      queue.push(resolved);
    }
  }

  while (queue.length > 0) {
    const file = queue.shift() as string;
    const chain = chains.get(file) as string[];
    const moduleName = relative(file);

    const forbiddenModule = FORBIDDEN_MODULES.find((rule) => rule.matches(moduleName));
    if (forbiddenModule) {
      violations.push({ module: moduleName, reason: `is ${forbiddenModule.label}`, chain });
      continue;
    }

    const source = readFileSync(file, 'utf8');
    const directive = directiveViolationOf(file, source);
    if (directive) violations.push({ module: moduleName, reason: directive, chain });

    for (const specifier of specifiersOf(source)) {
      if (isPackage(specifier, FORBIDDEN_PACKAGES) || isUnbundlableNodeModule(specifier)) {
        violations.push({ module: moduleName, reason: `imports ${specifier}`, chain });
        continue;
      }
      const resolved = resolveSpecifier(root, specifier, file);
      if (!resolved || chains.has(resolved)) continue;
      chains.set(resolved, [...chain, relative(resolved)]);
      queue.push(resolved);
    }
  }

  return violations;
}

function describeViolations(violations: Violation[]): string[] {
  return violations.map(({ module, reason, chain }) => `${module} ${reason} (${chain.join(' -> ')})`);
}

describe('modules the mobile app shares with the website', () => {
  it('reach nothing the app cannot bundle', () => {
    // Empty while mobile/ does not exist yet; from then on this is the gate.
    expect(describeViolations(findMobileSharedImportViolations(ROOT))).toEqual([]);
  });

  describe('the guard, run against fixtures', () => {
    it('passes an app whose shared imports stay clean', () => {
      expect(findMobileSharedImportViolations(path.join(FIXTURES, 'clean'))).toEqual([]);
    });

    it('fails on a Next import reached through a shared module, naming that module', () => {
      expect(describeViolations(findMobileSharedImportViolations(path.join(FIXTURES, 'next-import')))).toEqual([
        'lib/request-date.ts imports next/headers (mobile/app/index.tsx -> lib/session-label.ts -> lib/request-date.ts)',
      ]);
    });

    it('fails on a shared module that is server code by location', () => {
      expect(describeViolations(findMobileSharedImportViolations(path.join(FIXTURES, 'server-module')))).toEqual([
        'lib/supabase/server.ts is lib/supabase/* (mobile/app/index.tsx -> lib/track-names.ts -> lib/supabase/server.ts)',
      ]);
    });

    it('fails on a shared module carrying a client directive', () => {
      expect(describeViolations(findMobileSharedImportViolations(path.join(FIXTURES, 'client-directive')))).toEqual([
        'lib/unit-toggle.ts has a "use client" directive (mobile/app/index.tsx -> lib/unit-toggle.ts)',
      ]);
    });

    it('fails on a website-only import in the app itself, and lets React and React DOM through', () => {
      expect(describeViolations(findMobileSharedImportViolations(path.join(FIXTURES, 'direct-next')))).toEqual([
        'mobile/app/index.tsx imports next/headers (mobile/app/index.tsx)',
      ]);
    });

    it('fails on Node modules the app cannot run, prefixed or bare, and lets polyfillable names through', () => {
      expect(describeViolations(findMobileSharedImportViolations(path.join(FIXTURES, 'node-builtin')))).toEqual([
        'lib/fingerprint.ts imports node:crypto (mobile/app/index.tsx -> lib/fingerprint.ts)',
        'lib/file-name.ts imports fs (mobile/app/index.tsx -> lib/fingerprint.ts -> lib/file-name.ts)',
      ]);
    });

    it('fails on a shared module with a function-level server directive', () => {
      expect(describeViolations(findMobileSharedImportViolations(path.join(FIXTURES, 'inline-server')))).toEqual([
        'lib/save-lap.ts has a function-level "use server" directive (mobile/app/index.tsx -> lib/save-lap.ts)',
      ]);
    });

    it('follows a relative import that climbs out of mobile/ like an aliased one', () => {
      expect(describeViolations(findMobileSharedImportViolations(path.join(FIXTURES, 'relative-escape')))).toEqual([
        'lib/env.server.ts is lib/env.server (mobile/app/index.tsx -> lib/units.ts -> lib/env.server.ts)',
      ]);
    });
  });
});
