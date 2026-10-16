import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The generator is plain JS with no types (see migration-audit-generation.test.ts).
// @ts-expect-error - see above.
import { functionBodyMd5 } from '@/scripts/build-migration-audit.mjs';

// docs/beta-runbook.md carries a copy of 20261016000500 for the hosted project,
// which has no migration history and is patched in the SQL editor by hand. A
// copy that lost the pin would let a rider un-revoke a link or set its view
// count; one that lost the zone pin would relabel a shared book whenever the
// owner opened it from elsewhere; one that lost a revoke would let anybody open
// a book by its hash or read every link's row.
//
// Text only, like its twins: the runbook's verification query is what answers
// whether the block ran.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const MIGRATION = '20261016000500_add_service_book_sharing';
const migration = readFileSync(path.join(root, `supabase/migrations/${MIGRATION}.sql`), 'utf8');
const runbook = readFileSync(path.join(root, 'docs/beta-runbook.md'), 'utf8');

const BLOCK_MARKER = `-- hosted-service-book-sharing: mirror of supabase/migrations/${MIGRATION}.sql`;
const VERIFY_MARKER = '-- hosted-service-book-sharing-verify';
const ROLLBACK_MARKER = '-- hosted-service-book-sharing-rollback';

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

describe('the hosted service book sharing block in docs/beta-runbook.md', () => {
  it('is the migration statement for statement, in its order, inside one transaction', () => {
    const block = statements(fencedBlock(runbook, BLOCK_MARKER));

    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    expect(block.slice(1, -1)).toEqual(statements(migration));
  });

  it('verifies every function body the migration ships, by its md5', () => {
    const verify = fencedBlock(runbook, VERIFY_MARKER);
    for (const name of ['service_book_shares_pin', 'open_service_book_share', 'service_books_pin_owner_time_zone']) {
      expect(verify, name).toContain(`'${functionBodyMd5(MIGRATION, name)}'`);
    }
  });

  it('keeps the rollback a transaction that drops only what the migration made', () => {
    expect(statements(fencedBlock(runbook, ROLLBACK_MARKER))).toEqual([
      'begin',
      'drop function if exists public.open_service_book_share(text, boolean, integer, integer)',
      'drop table if exists public.service_book_shares',
      'drop function if exists public.service_book_shares_pin()',
      'drop trigger if exists service_books_pin_owner_time_zone on public.service_books',
      'drop function if exists public.service_books_pin_owner_time_zone()',
      'alter table public.service_books drop column if exists owner_time_zone',
      'commit',
    ]);
  });
});
