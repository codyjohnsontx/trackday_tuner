import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// docs/beta-runbook.md carries a copy of 20260924001700 for the hosted project,
// which has no migration history and is patched in the SQL editor by hand - the
// same arrangement, and the same drift risk, as the grants block that
// tests/unit/hosted-grants-runbook.test.ts guards. A copy that lost the revoke
// would leave the legacy `grant all` in place on hosted, and a rider holding
// UPDATE on ai_request_text can keep their text past 90 days by moving
// retain_until.
//
// Text only, like its twin: it says nothing about whether the block runs. The
// verification queries in the runbook are what answer that on hosted.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const migrationPath = path.join(
  root,
  'supabase/migrations/20260924001700_add_ai_request_text.sql',
);
const runbookPath = path.join(root, 'docs/beta-runbook.md');

const BLOCK_MARKER =
  '-- hosted-ai-request-text: mirror of supabase/migrations/20260924001700_add_ai_request_text.sql';
const ROLLBACK_MARKER = '-- hosted-ai-request-text-rollback:';

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

// Split on `;` on both sides alike, so the function body splits identically in
// each and still has to match line for line.
function statements(sql: string): string[] {
  return stripComments(sql)
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

const migration = readFileSync(migrationPath, 'utf8');
const runbook = readFileSync(runbookPath, 'utf8');

describe('the hosted ai_request_text block in docs/beta-runbook.md', () => {
  it('is the migration statement for statement, in its order, inside one transaction', () => {
    const block = statements(fencedBlock(runbook, BLOCK_MARKER));

    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    expect(block.slice(1, -1)).toEqual(statements(migration));
  });

  it('keeps the rollback a transaction that unschedules the job it drops the function for', () => {
    const rollback = statements(fencedBlock(runbook, ROLLBACK_MARKER));

    expect(rollback[0]).toBe('begin');
    expect(rollback[rollback.length - 1]).toBe('commit');
    // A job left pointing at a dropped function fails every night and says so
    // only in cron.job_run_details.
    expect(rollback[1]).toBe("select cron.unschedule('purge-expired-ai-request-text')");
  });
});
