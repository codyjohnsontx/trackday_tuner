import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The generator is plain JS with no types (see migration-audit-generation.test.ts).
// @ts-expect-error - see above.
import { functionBodyMd5 } from '@/scripts/build-migration-audit.mjs';

// docs/beta-runbook.md carries a copy of 20261001002500 for the hosted project,
// which is patched in the SQL editor by hand - the arrangement
// hosted-auto-track-rollback-runbook.test.ts guards for the migration before it.
// A copy that lost the ownership scope of the definer check would hand every
// rider a lookup into other riders' sessions, and a rollback that dropped the
// check without restoring the earlier take-back would leave a function calling
// one that is gone, so the apply, precheck, verify and rollback are all pinned.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const MIGRATION = '20261001002500_auto_created_track_reference_check_sees_every_session';
const PREVIOUS = '20260930002400_delete_auto_created_track_if_unused';
const migration = readFileSync(path.join(root, `supabase/migrations/${MIGRATION}.sql`), 'utf8');
const previous = readFileSync(path.join(root, `supabase/migrations/${PREVIOUS}.sql`), 'utf8');
const runbook = readFileSync(path.join(root, 'docs/beta-runbook.md'), 'utf8');

const BLOCK_MARKER = `-- hosted-track-reference-check: mirror of supabase/migrations/${MIGRATION}.sql`;
const PRECHECK_MARKER = '-- hosted-track-reference-check-precheck';
const VERIFY_MARKER = '-- hosted-track-reference-check-verify';
const ROLLBACK_MARKER = '-- hosted-track-reference-check-rollback';

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

describe('the hosted track reference check block in docs/beta-runbook.md', () => {
  it('is the migration statement for statement, in its order, inside one transaction', () => {
    const block = statements(fencedBlock(runbook, BLOCK_MARKER));

    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    expect(block.slice(1, -1)).toEqual(statements(migration));
  });

  it('carries both function bodies byte for byte, so the pasted functions fingerprint as the migration', () => {
    const bodies = dollarBodies(migration);
    expect(bodies).toHaveLength(2);
    expect(dollarBodies(fencedBlock(runbook, BLOCK_MARKER))).toEqual(bodies);
  });

  it('prechecks that the take-back it replaces is exactly 20260930002400 and the check is absent', () => {
    expect(statements(fencedBlock(runbook, PRECHECK_MARKER))).toEqual(
      statements(`
        select
          (select md5(p.prosrc) = '${functionBodyMd5(PREVIOUS)}'
             from pg_proc p
            where p.oid = to_regprocedure('public.delete_auto_created_track_if_unused(uuid)')) as take_back_is_20260930002400,
          to_regprocedure('public.auto_created_track_is_referenced(uuid)') is not null as check_exists;
      `),
    );
  });

  it('verifies both functions by security, search path, grants and body fingerprint', () => {
    const check = functionBodyMd5(MIGRATION, 'auto_created_track_is_referenced');
    const takeBack = functionBodyMd5(MIGRATION, 'delete_auto_created_track_if_unused');
    expect(statements(fencedBlock(runbook, VERIFY_MARKER))).toEqual(
      statements(`
        select
          p.proname as function,
          p.prosecdef as security_definer,
          p.proconfig as settings,
          has_function_privilege('authenticated', p.oid, 'execute') as rider_can_execute,
          has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
          md5(p.prosrc) in ('${check}', '${takeBack}') as definition_is_the_migration
        from pg_proc p
        where p.oid in (
          to_regprocedure('public.auto_created_track_is_referenced(uuid)'),
          to_regprocedure('public.delete_auto_created_track_if_unused(uuid)')
        )
        order by p.proname;
      `),
    );
  });

  it('rolls back by restoring the 20260930002400 take-back byte for byte, then dropping the check', () => {
    const block = fencedBlock(runbook, ROLLBACK_MARKER);
    // The earlier migration's function, without its grants: those are unchanged.
    const restored = statements(
      previous.slice(previous.indexOf('create or replace function'), previous.indexOf('revoke all on function')),
    );

    expect(statements(block)).toEqual([
      'begin',
      ...restored,
      'drop function if exists public.auto_created_track_is_referenced(uuid)',
      'commit',
    ]);
    expect(dollarBodies(block)).toEqual(dollarBodies(previous));
  });
});
