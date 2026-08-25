import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// docs/beta-runbook.md carries a copy of 20260719001100 for the hosted project,
// which has no migration history for `db push` to work from and is patched in
// the SQL editor by hand. A copy drifts: a later change to the migration's
// grants would leave the runbook applying yesterday's, and a hand edit to the
// block would leave the hosted project with statements no migration describes.
// This reads both and fails on the first statement they disagree about.
//
// It reads SQL as text, like tests/unit/migrations-bootstrap.test.ts, so it says
// nothing about whether the block runs or what the hosted project holds. The
// verification queries in the runbook, and
// tests/e2e/profile-entitlement-columns.spec.ts pointed at the project, are
// what answer that.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const migrationPath = path.join(
  root,
  'supabase/migrations/20260719001100_grant_data_api_access.sql',
);
const runbookPath = path.join(root, 'docs/beta-runbook.md');

// Each block in the runbook opens on a marker comment, so the block is found by
// what it says it is rather than by its position among the other SQL there.
const BLOCK_MARKER =
  '-- hosted-grants: mirror of supabase/migrations/20260719001100_grant_data_api_access.sql';
const TABLES_MARKER = '-- hosted-grants-tables:';
const ROLLBACK_MARKER = '-- hosted-grants-rollback:';

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

// One entry per statement, lowercased with whitespace collapsed, so a line
// break moved or a keyword recased does not register as a difference while a
// changed role, privilege or table does.
function statements(sql: string): string[] {
  return stripComments(sql)
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((statement) => statement.length > 0);
}

// The fenced block whose first line is `marker`, up to its closing fence.
function fencedBlock(markdown: string, marker: string): string {
  const start = markdown.indexOf(marker);
  if (start === -1) throw new Error(`docs/beta-runbook.md has no block opening with ${marker}`);
  const end = markdown.indexOf('\n```', start);
  if (end === -1) throw new Error(`the block opening with ${marker} never closes`);
  return markdown.slice(start, end);
}

const migration = readFileSync(migrationPath, 'utf8');
const runbook = readFileSync(runbookPath, 'utf8');

describe('the hosted apply block in docs/beta-runbook.md', () => {
  it('is the grants migration statement for statement, in its order, inside one transaction', () => {
    const block = statements(fencedBlock(runbook, BLOCK_MARKER));

    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    expect(block.slice(1, -1)).toEqual(statements(migration));
  });

  it('pre-checks exactly the tables the migration grants to authenticated', () => {
    const granted = [
      ...new Set(
        Array.from(
          stripComments(migration).matchAll(
            /grant\s+[^;]*?\son\s+public\.(\w+)\s+to\s+authenticated/gi,
          ),
          (match) => match[1],
        ),
      ),
    ].sort();
    const inList = /table_name\s+in\s*\(([\s\S]*?)\)/i.exec(fencedBlock(runbook, TABLES_MARKER));
    const listed = Array.from(inList?.[1].matchAll(/'(\w+)'/g) ?? [], (match) => match[1]).sort();

    expect(listed).toEqual(granted);
    // The documented answer to that query is the count, and it has to move with
    // the list.
    expect(runbook).toContain(`Expect \`${granted.length}\`.`);
  });

  it('keeps the rollback a transaction that hands the Data API roles data privileges only', () => {
    const rollback = statements(fencedBlock(runbook, ROLLBACK_MARKER));

    expect(rollback[0]).toBe('begin');
    expect(rollback[rollback.length - 1]).toBe('commit');
    for (const statement of rollback.slice(1, -1)) {
      expect(statement).toMatch(/^(?:grant|alter default privileges) .* to anon, authenticated$/);
      // Nothing uses these, RLS does not contain truncate, and restoring them
      // would be a wider hole than the one the rollback is recovering from.
      // `grant all` is the spelling that hands them over without naming them.
      expect(statement).not.toMatch(/\bgrant\s+all\b/);
      expect(statement).not.toMatch(/\b(?:truncate|references|trigger)\b/);
    }
  });
});
