import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The service-book rules are shared code: the website renders them now, and the
 * phone app is to import them to raise its own "this day pushed an item past
 * due" notice after a sync. So they import no Next, no `server-only`, no
 * Supabase client and no React - nothing but each other, the pure date helpers
 * and `types/supabase.ts`, and that one for types only, which compile away.
 *
 * This pins the whole import list of each module, rather than a deny list, so a
 * new import of any kind is a decision somebody makes here.
 * `tests/unit/mobile-shared-imports.test.ts` guards what the app reaches once
 * `mobile/` exists; this holds these modules to it before then.
 */

const ROOT = path.resolve(__dirname, '../..');

const EXPECTED: Record<string, string[]> = {
  'lib/service-book/calendar.ts': [],
  'lib/service-book/usage.ts': ['@/lib/service-book/calendar', 'type @/types/supabase'],
  'lib/service-book/due.ts': [
    '@/lib/local-date',
    '@/lib/service-book/calendar',
    '@/lib/service-book/usage',
    'type @/types/supabase',
  ],
  'lib/service-book/provenance.ts': ['@/lib/local-date', '@/lib/service-book/calendar', 'type @/types/supabase'],
  'lib/service-book/fields.ts': ['@/lib/service-book/calendar', 'type @/types/supabase'],
  // Reached through the modules above, so held to the same list.
  'lib/local-date.ts': [],
};

/** Each import as its specifier, prefixed `type ` when the whole import is type-only. */
function importsOf(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(path.join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
      const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly === true : node.isTypeOnly;
      found.push(typeOnly ? `type ${specifier}` : specifier);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const [argument] = node.arguments;
      found.push(argument && ts.isStringLiteral(argument) ? argument.text : '<dynamic>');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.sort();
}

describe('the service-book rules stay framework-free', () => {
  for (const [file, expected] of Object.entries(EXPECTED)) {
    it(`${file} imports only what it is allowed to`, () => {
      expect(importsOf(file)).toEqual([...expected].sort());
    });
  }

  it('covers every module the rules reach', () => {
    const reached = new Set<string>();
    for (const imports of Object.values(EXPECTED)) {
      for (const specifier of imports) {
        if (specifier.startsWith('@/lib/')) reached.add(`${specifier.slice(2)}.ts`);
      }
    }
    for (const file of reached) expect(Object.keys(EXPECTED)).toContain(file);
  });

  it('has no forbidden import anywhere on the list', () => {
    const forbidden = /^(type )?(next(\/|$)|server-only$|@supabase\/|@\/lib\/supabase\/|react(-dom)?(\/|$))/;
    for (const imports of Object.values(EXPECTED)) {
      for (const specifier of imports) expect(specifier).not.toMatch(forbidden);
    }
  });
});
