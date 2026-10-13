import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The generator is plain JS with no types (see migration-audit-generation.test.ts).
// @ts-expect-error - see above.
import { functionBodyMd5 } from '@/scripts/build-migration-audit.mjs';

// docs/beta-runbook.md carries a copy of 20261013000300 for the hosted project,
// which has no migration history and is patched in the SQL editor by hand. A
// copy that lost the reconciliation of items and parts, or the TT404 on a
// removed entry, would turn every untouched Save into an edit or let a removed
// entry be rewritten - the two things the function exists to prevent.
//
// Text only, like its twins: the runbook's verification query is what answers
// whether the block ran.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const MIGRATION = '20261013000300_add_save_service_entry';
const migration = readFileSync(path.join(root, `supabase/migrations/${MIGRATION}.sql`), 'utf8');
const runbook = readFileSync(path.join(root, 'docs/beta-runbook.md'), 'utf8');

const BLOCK_MARKER = `-- hosted-save-service-entry: mirror of supabase/migrations/${MIGRATION}.sql`;
const VERIFY_MARKER = '-- hosted-save-service-entry-verify';
const ROLLBACK_MARKER = '-- hosted-save-service-entry-rollback';

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

describe('the hosted save_service_entry block in docs/beta-runbook.md', () => {
  it('is the migration statement for statement, in its order, inside one transaction', () => {
    const block = statements(fencedBlock(runbook, BLOCK_MARKER));

    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    expect(block.slice(1, -1)).toEqual(statements(migration));
  });

  it('verifies the body the migration ships, by its md5', () => {
    expect(fencedBlock(runbook, VERIFY_MARKER)).toContain(`'${functionBodyMd5(MIGRATION)}'`);
  });

  it('keeps the rollback a transaction that drops only the function', () => {
    expect(statements(fencedBlock(runbook, ROLLBACK_MARKER))).toEqual([
      'begin',
      'drop function if exists public.save_service_entry(uuid, uuid, jsonb, jsonb, jsonb)',
      'commit',
    ]);
  });
});
