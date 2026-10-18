import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

/**
 * A handed-over bike exists twice, and the two copies never see each other's
 * later data (owner, PQ2). The schema keeps them apart with RLS; what keeps the
 * APP apart is that the link columns the copy writes - `transferred_from_book_id`,
 * `copied_from_entry_id`, `copied_from_session_id`,
 * `copied_from_attachment_id` - are pointers nothing follows. A screen reads
 * one as a boolean ("came with the bike"), a cap reads one as a filter ("not a
 * copy"), and that is all: a query that equates one to an id is a read into
 * the other rider's rows, and RLS would refuse it in production while a
 * service-role path would not.
 *
 * This sweep holds that. It reads the deployment's code as code, the way
 * `rpc-call-sites.test.ts` does, and flags any PostgREST filter whose column is
 * a pointer unless the filter only asks whether the pointer is null: `.is(ptr,
 * null)` and an `.or()` string carrying `ptr.is.null` / `ptr.not.is.null` are
 * the allowed shapes. It is proven against `tests/fixtures/transfer-pointers/`,
 * where each way of following a pointer is written out, before it is run over
 * a repository that already gets it right.
 */

const ROOT = path.resolve(__dirname, '../..');
const DEPLOYMENT_TREES = ['app', 'lib', 'components'];
const FIXTURES = path.resolve(__dirname, '../fixtures/transfer-pointers');

const POINTER = /^(?:copied_from_\w+|transferred_from_\w+)$/;

/** The PostgREST filter methods that take a column first. */
const FILTERS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy', 'match', 'not', 'filter', 'textSearch']);

interface Follow {
  file: string;
  line: number;
  text: string;
}

/** Every place `text` follows a pointer: a filter on one that is not a null check. */
export function pointerFollowsIn(file: string, text: string): Follow[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Follow[] = [];
  const flag = (node: ts.Node) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push({ file, line: line + 1, text: node.getText(source).replace(/\s+/g, ' ') });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const [first, second] = node.arguments;
      if (FILTERS.has(method) && first && ts.isStringLiteralLike(first) && POINTER.test(first.text)) {
        const nullCheck = method === 'is' && second && second.kind === ts.SyntaxKind.NullKeyword;
        if (!nullCheck) flag(node);
      }
      if (method === 'or' && first) {
        const pieces = ts.isStringLiteralLike(first) ? [first.text] : ts.isTemplateExpression(first) ? [first.head.text, ...first.templateSpans.map((span) => span.literal.text)] : [];
        for (const piece of pieces) {
          for (const match of piece.matchAll(/(copied_from_\w+|transferred_from_\w+)\.((?:not\.)?[a-z]+)(?:\.([^,()]*))?/g)) {
            const [, , operator, operand] = match;
            const nullCheck = (operator === 'is' || operator === 'not.is') && (operand === 'null' || operand === undefined);
            if (!nullCheck) {
              flag(node);
              break;
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

function followsUnder(dirs: string[]): Follow[] {
  return dirs.flatMap((dir) =>
    sourceFiles(dir).flatMap((file) => pointerFollowsIn(path.relative(ROOT, file), readFileSync(file, 'utf8'))),
  );
}

describe('handover pointers are never followed', () => {
  it('flags each way of following one in the fixtures', () => {
    for (const fixture of ['follows-by-eq.ts', 'follows-by-in.ts', 'follows-in-or.ts']) {
      const follows = pointerFollowsIn(fixture, readFileSync(path.join(FIXTURES, fixture), 'utf8'));
      expect(follows, fixture).toHaveLength(1);
    }
  });

  it('does not flag a null check, which is how the free caps read a pointer', () => {
    const follows = pointerFollowsIn('allowed-null-checks.ts', readFileSync(path.join(FIXTURES, 'allowed-null-checks.ts'), 'utf8'));
    expect(follows).toEqual([]);
  });

  it('finds nothing in the deployment that follows one', () => {
    const follows = followsUnder(DEPLOYMENT_TREES.map((dir) => path.join(ROOT, dir)));
    expect(follows.map((follow) => `${follow.file}:${follow.line} ${follow.text}`)).toEqual([]);
  });

  // If the sweep could not see the pointer reads that ARE there, the assertion
  // above would pass over nothing. These are the two the caps make today.
  it('still sees the null checks the deployment makes, so an empty answer means it looked', () => {
    const seen: string[] = [];
    for (const dir of DEPLOYMENT_TREES) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        const text = readFileSync(file, 'utf8');
        if (/copied_from_session_id\.is\.null|\.is\('copied_from_|copied_from_attachment_id === null/.test(text)) seen.push(path.relative(ROOT, file));
      }
    }
    expect(seen).toContain('lib/actions/sessions.ts');
  });
});
