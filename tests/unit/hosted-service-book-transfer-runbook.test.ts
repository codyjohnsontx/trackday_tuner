import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The generator is plain JS with no types (see migration-audit-generation.test.ts).
// @ts-expect-error - see above.
import { functionBodyMd5 } from '@/scripts/build-migration-audit.mjs';

// docs/beta-runbook.md carries a copy of 20261017000600 for the hosted project,
// which has no migration history and is patched in the SQL editor by hand. A
// copy that lost the sold-bike policies would leave the seller's copy writable;
// one that lost the session pin would let a rider mark their own sessions
// copied and escape the free cap; one that lost a revoke would let the service
// role or a visitor run the copy.
//
// This migration replaces six functions and twenty policies earlier blocks
// pasted, so its rollback has to put them back. It is held to the earlier
// migrations themselves: each function statement is the one that migration
// created, and each policy is that migration's `create policy` read as an
// `alter policy`, so the rollback restores exactly what the repository last
// shipped and cannot drift from it.
//
// Text only, like its twins: the runbook's verification query is what answers
// whether the block ran.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const MIGRATION = '20261017000600_add_service_book_transfer';
const read = (name: string) => readFileSync(path.join(root, `supabase/migrations/${name}.sql`), 'utf8');
const migration = read(MIGRATION);
const runbook = readFileSync(path.join(root, 'docs/beta-runbook.md'), 'utf8');

const BLOCK_MARKER = `-- hosted-service-book-transfer: mirror of supabase/migrations/${MIGRATION}.sql`;
const PRECHECK_MARKER = '-- hosted-service-book-transfer-precheck';
const VERIFY_MARKER = '-- hosted-service-book-transfer-verify';
const ROLLBACK_MARKER = '-- hosted-service-book-transfer-rollback';

/** The functions this migration replaces, and the migration whose body the rollback restores. */
const REPLACED: [string, string][] = [
  ['20261010000100_add_service_book', 'service_entries_pin'],
  ['20261010000100_add_service_book', 'record_service_entry_revision'],
  ['20260928002300_session_vehicle_ownership_and_deleted_sessions', 'create_session_with_laps'],
  ['20261013000300_add_save_service_entry', 'save_service_entry'],
  ['20261014000400_add_service_attachments', 'reserve_service_attachment'],
  ['20261014000400_add_service_attachments', 'confirm_service_attachment'],
];

/** The migrations that created the policies this one alters. */
const POLICY_SOURCES = ['20261010000100_add_service_book', '20261010000200_add_service_usage_overrides'];

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

function functionStatement(source: string, name: string): string {
  const found = [...read(source).matchAll(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\bas \\$\\$[\\s\\S]*?\\$\\$;`, 'g'))];
  expect(found, `${source} creates public.${name} once`).toHaveLength(1);
  return found[0][0];
}

const alteredPolicies = [...migration.matchAll(/alter policy "([^"]+)"/g)].map((match) => match[1]);

function earlierPolicyAsAlter(name: string): string {
  const sources = POLICY_SOURCES.map(read).join('\n');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = [...sources.matchAll(new RegExp(`create policy "${escaped}"[\\s\\S]*?;`, 'g'))];
  expect(found, `one earlier migration creates "${name}"`).toHaveLength(1);
  return found[0][0].replace(/^create policy ("[^"]+")\s+on (public\.\w+) for \w+\s+/, 'alter policy $1 on $2 ');
}

describe('the hosted service book transfer block in docs/beta-runbook.md', () => {
  it('is the migration statement for statement, in its order, inside one transaction', () => {
    const block = statements(fencedBlock(runbook, BLOCK_MARKER));

    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    expect(block.slice(1, -1)).toEqual(statements(migration));
  });

  it('prechecks that every body it replaces is the one the repository last pasted, and every policy it alters is there', () => {
    const precheck = fencedBlock(runbook, PRECHECK_MARKER);
    for (const [source, name] of REPLACED) {
      expect(precheck, name).toContain(`('${name}', '${functionBodyMd5(source, name)}')`);
    }
    expect(alteredPolicies).toHaveLength(20);
    for (const name of alteredPolicies) expect(precheck, name).toContain(`'${name}'`);
  });

  it('verifies every function body the migration ships, by its md5, and every policy it guards', () => {
    const verify = fencedBlock(runbook, VERIFY_MARKER);
    const shipped = [...migration.matchAll(/create or replace function public\.(\w+)\(/g)].map((match) => match[1]);
    expect(shipped.length).toBeGreaterThan(REPLACED.length);
    for (const name of shipped) {
      expect(verify, name).toContain(`('${name}', '${functionBodyMd5(MIGRATION, name)}')`);
    }
    for (const name of alteredPolicies) expect(verify, name).toContain(`'${name}'`);
  });

  it('rolls back in one transaction to the earlier bodies and policies, then drops only what the migration made', () => {
    expect(statements(fencedBlock(runbook, ROLLBACK_MARKER))).toEqual(
      statements(
        [
          'begin;',
          'drop function if exists public.accept_service_book_transfer(text, jsonb);',
          'drop function if exists public.prepare_service_book_transfer_accept(text);',
          'drop function if exists public.describe_service_book_transfer(text, uuid, text);',
          'drop function if exists public.cancel_service_book_transfer(uuid);',
          'drop function if exists public.create_service_book_transfer(uuid, text, text, numeric, numeric, text);',
          'drop function if exists public.service_book_transfer_admit(public.service_book_transfers);',
          'drop table if exists public.service_book_transfers;',
          'drop function if exists public.service_book_transfer_photo_destination(text, uuid, uuid);',
          'drop function if exists public.service_book_transfer_photo_source(text, text, uuid);',
          ...REPLACED.map(([source, name]) => functionStatement(source, name)),
          'drop function if exists public.service_attachment_object_path(uuid, uuid, text, boolean);',
          ...alteredPolicies.map(earlierPolicyAsAlter),
          'drop function if exists public.service_entry_writable(uuid);',
          'drop function if exists public.service_book_writable(uuid);',
          'drop trigger if exists sessions_refuse_sold_vehicle on public.sessions;',
          'drop function if exists public.sessions_refuse_sold_vehicle();',
          'drop trigger if exists sessions_pin_transfer_origin on public.sessions;',
          'drop function if exists public.sessions_pin_transfer_origin();',
          'drop trigger if exists vehicles_pin_sold_at on public.vehicles;',
          'drop function if exists public.vehicles_pin_sold_at();',
          'alter table public.service_attachments drop column if exists copied_from_attachment_id;',
          'alter table public.sessions drop column if exists original_user_id;',
          'alter table public.sessions drop column if exists copied_from_session_id;',
          'alter table public.service_books drop column if exists transferred_removed_entry_count;',
          'alter table public.vehicles drop column if exists sold_at;',
          'commit;',
        ].join('\n'),
      ),
    );
  });
});
