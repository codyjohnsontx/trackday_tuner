import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// docs/beta-runbook.md carries a copy of 20260925001800 for the hosted project,
// which has no migration history and is patched in the SQL editor by hand - the
// arrangement tests/unit/hosted-ai-request-text-runbook.test.ts guards for the
// table this column belongs to. A copy that lost the backfill would leave every
// existing rider keeping by default on hosted, which is the decision this
// migration exists to reverse.
//
// Text only, like its twins: the runbook's verification query is what answers
// whether the block ran.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const migration = readFileSync(
  path.join(root, 'supabase/migrations/20260925001800_question_retention_opt_in_for_everyone.sql'),
  'utf8',
);
const runbook = readFileSync(path.join(root, 'docs/beta-runbook.md'), 'utf8');

const BLOCK_MARKER =
  '-- hosted-question-retention-opt-in: mirror of supabase/migrations/20260925001800_question_retention_opt_in_for_everyone.sql';

function statements(sql: string): string[] {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((statement) => statement.length > 0);
}

function fencedBlock(markdown: string, marker: string): string {
  const start = markdown.indexOf(marker);
  if (start === -1) throw new Error(`docs/beta-runbook.md has no block opening with ${marker}`);
  const end = markdown.indexOf('\n```', start);
  if (end === -1) throw new Error(`the block opening with ${marker} never closes`);
  return markdown.slice(start, end);
}

describe('the hosted question-retention opt-in block in docs/beta-runbook.md', () => {
  it('is the migration statement for statement, in its order, inside one transaction', () => {
    const block = statements(fencedBlock(runbook, BLOCK_MARKER));

    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    expect(block.slice(1, -1)).toEqual(statements(migration));
  });
});
