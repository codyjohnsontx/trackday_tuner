import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The generator is plain JS with no types (see migration-audit-generation.test.ts).
// @ts-expect-error - see above.
import { functionBodyMd5 } from '@/scripts/build-migration-audit.mjs';

// docs/beta-runbook.md carries a copy of 20260927002200 for the hosted project,
// which has no migration history and is patched in the SQL editor by hand - the
// arrangement tests/unit/hosted-delete-vehicle-guard-runbook.test.ts guards for
// the migration before it. A copy that lost the replay check, or wrote the laps
// or environment outside the one transaction, would let a phone retry report a
// session synced while part of it was never stored.
//
// Text only, like its twins, because the runbook is text the owner pastes. The
// verify query is what answers whether the block ran, so it is pinned here as
// exactly as the apply block: it fingerprints the installed body against the
// migration's, and a verify that stopped doing that - or checked a stale hash -
// would pass a hosted function that is not this migration.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const migration = readFileSync(
  path.join(root, 'supabase/migrations/20260927002200_add_create_session_with_laps.sql'),
  'utf8',
);
const runbook = readFileSync(path.join(root, 'docs/beta-runbook.md'), 'utf8');

const BLOCK_MARKER =
  '-- hosted-session-create: mirror of supabase/migrations/20260927002200_add_create_session_with_laps.sql';
const ROLLBACK_MARKER = '-- hosted-session-create-rollback';
const VERIFY_MARKER = '-- hosted-session-create-verify';

/** The text between `as $$` and `$$;`, which Postgres stores as `prosrc`. */
function dollarBody(sql: string): string {
  const bodies = [...sql.matchAll(/\bas \$\$([\s\S]*?)\$\$;/g)];
  if (bodies.length !== 1) throw new Error(`expected one dollar-quoted body, found ${bodies.length}`);
  return bodies[0][1];
}

// Split on `;` on both sides alike, so the function body splits identically in
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

describe('the hosted session create block in docs/beta-runbook.md', () => {
  it('is the migration statement for statement, in its order, inside one transaction', () => {
    const block = statements(fencedBlock(runbook, BLOCK_MARKER));

    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    expect(block.slice(1, -1)).toEqual(statements(migration));
  });

  it('keeps the rollback a transaction that drops only the function', () => {
    expect(statements(fencedBlock(runbook, ROLLBACK_MARKER))).toEqual([
      'begin',
      'drop function if exists public.create_session_with_laps(uuid, jsonb, jsonb, jsonb)',
      'commit',
    ]);
  });

  it('carries the migration body byte for byte, so the pasted function fingerprints as the migration', () => {
    expect(dollarBody(fencedBlock(runbook, BLOCK_MARKER))).toBe(dollarBody(migration));
  });

  it('verifies security, search path, grants and the exact body fingerprint of the migration', () => {
    const md5 = functionBodyMd5('20260927002200_add_create_session_with_laps');
    expect(statements(fencedBlock(runbook, VERIFY_MARKER))).toEqual(
      statements(`
        select
          p.prosecdef as security_definer,
          p.proconfig as settings,
          has_function_privilege('authenticated', p.oid, 'execute') as rider_can_execute,
          has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
          md5(p.prosrc) = '${md5}' as definition_is_the_migration
        from pg_proc p
        where p.oid = to_regprocedure('public.create_session_with_laps(uuid,jsonb,jsonb,jsonb)');
      `),
    );
  });
});
