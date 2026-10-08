import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The generator is plain JS with no types (see migration-audit-generation.test.ts).
// @ts-expect-error - see above.
import { functionBodyMd5 } from '@/scripts/build-migration-audit.mjs';

// docs/beta-runbook.md carries a copy of 20261010000100 and 20261010000200 for
// the hosted project, which has no migration history and is patched in the SQL
// editor by hand. A copy that drifted from the migrations - a dropped revoke, a
// pin trigger's body edited - would leave the hosted book less honest than the
// one every test here proves, while the audit row read its own name and passed.
// So the apply block is held to the migrations statement for statement, the
// verify query's fingerprints to the migrations' trigger bodies, and the
// rollback to everything the two files create.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const BOOK = '20261010000100_add_service_book';
const OVERRIDES = '20261010000200_add_service_usage_overrides';
const book = readFileSync(path.join(root, `supabase/migrations/${BOOK}.sql`), 'utf8');
const overrides = readFileSync(path.join(root, `supabase/migrations/${OVERRIDES}.sql`), 'utf8');
const runbook = readFileSync(path.join(root, 'docs/beta-runbook.md'), 'utf8');

const BLOCK_MARKER = `-- hosted-service-book: mirror of supabase/migrations/${BOOK}.sql`;
const PRECHECK_MARKER = '-- hosted-service-book-precheck';
const VERIFY_MARKER = '-- hosted-service-book-verify';
const ROLLBACK_MARKER = '-- hosted-service-book-rollback';

const TRIGGER_FUNCTIONS = [
  'service_entries_pin',
  'record_service_entry_revision',
  'touch_service_entry',
  'sync_service_entry_reading',
];

/** Every text between `as $$` and `$$;`, which Postgres stores as `prosrc`. */
function dollarBodies(sql: string): string[] {
  return [...sql.matchAll(/\bas \$\$([\s\S]*?)\$\$;/g)].map((match) => match[1]);
}

// Split on `;` on both sides alike, so a function body splits identically in
// each and still has to match line for line.
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

function created(sql: string, kind: 'table' | 'function'): string[] {
  const pattern =
    kind === 'table'
      ? /create table if not exists public\.(\w+)/g
      : /create or replace function public\.(\w+)\(/g;
  return [...sql.matchAll(pattern)].map((match) => match[1]);
}

describe('the hosted service book block in docs/beta-runbook.md', () => {
  it('is both migrations statement for statement, in their order, inside one transaction', () => {
    const block = statements(fencedBlock(runbook, BLOCK_MARKER));

    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    expect(block.slice(1, -1)).toEqual([...statements(book), ...statements(overrides)]);
  });

  it('carries every function body byte for byte, so the pasted functions fingerprint as the migration', () => {
    const bodies = [...dollarBodies(book), ...dollarBodies(overrides)];
    expect(bodies.length).toBeGreaterThan(0);
    expect(dollarBodies(fencedBlock(runbook, BLOCK_MARKER))).toEqual(bodies);
  });

  it('prechecks that nothing of it is there yet and what it builds on is', () => {
    expect(statements(fencedBlock(runbook, PRECHECK_MARKER))).toEqual(
      statements(`
        select
          to_regclass('public.service_books') is not null as service_books_exists,
          to_regclass('public.session_usage_weights') is not null as usage_weights_exists,
          to_regprocedure('public.service_book_owned(uuid)') is not null as owned_helper_exists,
          to_regprocedure('public.set_updated_at()') is not null as set_updated_at_exists,
          has_table_privilege('authenticated', 'public.vehicles', 'select') as rider_can_read_vehicles;
      `),
    );
  });

  it('verifies every table the migrations create and the trigger bodies they install', () => {
    const verify = fencedBlock(runbook, VERIFY_MARKER);
    const listed = [...verify.matchAll(/\('(\w+)'\)/g)].map((match) => match[1]);
    expect(listed.sort()).toEqual([...created(book, 'table'), ...created(overrides, 'table')].sort());

    for (const fn of TRIGGER_FUNCTIONS) {
      expect(verify).toContain(`to_regprocedure('public.${fn}()')`);
      expect(verify).toContain(`'${functionBodyMd5(BOOK, fn)}'`);
    }
  });

  it('rolls back by dropping every table and function the migrations create', () => {
    const block = statements(fencedBlock(runbook, ROLLBACK_MARKER));

    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    const dropped = block.slice(1, -1);
    for (const table of [...created(book, 'table'), ...created(overrides, 'table')]) {
      expect(dropped).toContain(`drop table if exists public.${table}`);
    }
    const functions = [...created(book, 'function'), ...created(overrides, 'function')];
    expect(functions.length).toBeGreaterThan(0);
    for (const fn of functions) {
      expect(dropped.some((statement) => statement.startsWith(`drop function if exists public.${fn}(`))).toBe(true);
    }
  });
});
