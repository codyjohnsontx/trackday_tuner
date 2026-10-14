import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The service-book rules are shared code: the website renders them now, and the
 * phone app is to import them to raise its own "this day pushed an item past
 * due" notice after a sync. So they import no Next, no `server-only`, no
 * Supabase client and no React - nothing but each other, the pure date helpers
 * and `types/supabase.ts`, and that one for types only, which compile away.
 *
 * This loads each module in plain Node, outside Vite and Next, through a resolve
 * hook that refuses every package and every file not on `ALLOWED`. So it proves
 * the modules run with nothing but those files, rather than reading their
 * import lines, and a new import of any kind is a decision somebody makes here.
 * `tests/unit/mobile-shared-imports.test.ts` guards what the app reaches once
 * `mobile/` exists; this holds these modules to it before then.
 */

const ROOT = path.resolve(__dirname, '../..');

const RULES = [
  'lib/service-book/calendar.ts',
  'lib/service-book/usage.ts',
  'lib/service-book/due.ts',
  'lib/service-book/provenance.ts',
  'lib/service-book/fields.ts',
  'lib/service-book/format.ts',
  'lib/service-book/entry-draft.ts',
  'lib/service-book/reminders.ts',
  'lib/service-book/book-data.ts',
];

/** Every file the rules may reach when they run. */
const ALLOWED = [...RULES, 'lib/local-date.ts'];

const HOOKS = `
import { resolve as resolveAlias } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'scripts/eval/ts-loader.mjs')).href)};
let allowed = new Set();
export function initialize(data) { allowed = new Set(data.allowed); }
export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('@/') && !specifier.startsWith('.') && !specifier.startsWith('file:')) {
    throw new Error('refused package ' + specifier + ' imported by ' + context.parentURL);
  }
  const resolved = specifier.startsWith('@/')
    ? resolveAlias(specifier, context, nextResolve)
    : await nextResolve(specifier, context);
  if (!allowed.has(resolved.url)) throw new Error('refused file ' + resolved.url + ' imported by ' + context.parentURL);
  return resolved;
}
`;

/** Imports `file` in a fresh Node process that may reach only `allowed`. */
function loadInPlainNode(file: string, allowed: readonly string[]): { status: number | null; stderr: string } {
  const toUrl = (relative: string) => pathToFileURL(path.join(ROOT, relative)).href;
  const script = `
    import { register } from 'node:module';
    register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(HOOKS)}), { data: { allowed: ${JSON.stringify(allowed.map(toUrl))} } });
    await import(${JSON.stringify(toUrl(file))});
  `;
  const result = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { status: result.status, stderr: result.stderr };
}

describe('the service-book rules stay framework-free', () => {
  for (const file of RULES) {
    it(`${file} runs in plain Node reaching only the allowed files`, () => {
      const result = loadInPlainNode(file, ALLOWED);
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    });
  }

  it('refuses a module that reaches a package', () => {
    const result = loadInPlainNode('lib/supabase/admin.ts', ['lib/supabase/admin.ts']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('refused package @supabase/supabase-js');
  });

  it('refuses a module that reaches a file off the list', () => {
    const result = loadInPlainNode('lib/service-book/due.ts', RULES);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`refused file ${pathToFileURL(path.join(ROOT, 'lib/local-date.ts')).href}`);
  });
});
