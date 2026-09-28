import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The generator is plain JS with no types (see migration-audit-generation.test.ts).
// @ts-expect-error - see above.
import { SESSION_VEHICLE_OWNED_CHECK_MD5, functionBodyMd5 } from '@/scripts/build-migration-audit.mjs';

// docs/beta-runbook.md carries a copy of 20260928002300 for the hosted project,
// which has no migration history and is patched in the SQL editor by hand - the
// arrangement hosted-session-create-runbook.test.ts guards for the migration
// before it. A copy that lost the vehicle check from a policy, the tombstone
// lookup or the capped count would leave the hosted project with the defect
// the migration closes, and the verify query is what would have to notice. So
// the apply block, its verify query, its precheck and its rollback are all
// pinned here, the verify by the same fingerprints the audit probe uses.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const MIGRATION = '20260928002300_session_vehicle_ownership_and_deleted_sessions';
const PREVIOUS = '20260927002200_add_create_session_with_laps';
const migration = readFileSync(path.join(root, `supabase/migrations/${MIGRATION}.sql`), 'utf8');
const previous = readFileSync(path.join(root, `supabase/migrations/${PREVIOUS}.sql`), 'utf8');
const runbook = readFileSync(path.join(root, 'docs/beta-runbook.md'), 'utf8');

const BLOCK_MARKER = `-- hosted-session-ownership: mirror of supabase/migrations/${MIGRATION}.sql`;
const PRECHECK_MARKER = '-- hosted-session-ownership-precheck';
const VERIFY_MARKER = '-- hosted-session-ownership-verify';
const ROLLBACK_MARKER = '-- hosted-session-ownership-rollback';

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

describe('the hosted session ownership block in docs/beta-runbook.md', () => {
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

  it('prechecks that the function it replaces is exactly 20260927002200', () => {
    const precheck = fencedBlock(runbook, PRECHECK_MARKER);
    expect(precheck).toContain(`md5(p.prosrc) = '${functionBodyMd5(PREVIOUS)}'`);
    expect(precheck).toContain('where v.user_id <> s.user_id');
    // Read-only: nothing in it writes.
    expect(statements(precheck).every((statement) => statement.startsWith('select'))).toBe(true);
  });

  it('verifies both bodies, security, grants, the trigger, the table and the policy fingerprint', () => {
    expect(statements(fencedBlock(runbook, VERIFY_MARKER))).toEqual(
      statements(`
        select
          (select md5(p.prosrc) = '${functionBodyMd5(MIGRATION, 'create_session_with_laps')}'
                  and not p.prosecdef
                  and p.proconfig = array['search_path=""']
                  and has_function_privilege('authenticated', p.oid, 'execute')
                  and not has_function_privilege('anon', p.oid, 'execute')
             from pg_proc p
            where p.oid = to_regprocedure('public.create_session_with_laps(uuid,jsonb,jsonb,jsonb)'))
            as create_function_is_the_migration,
          (select md5(p.prosrc) = '${functionBodyMd5(MIGRATION, 'record_deleted_session')}'
                  and p.prosecdef
                  and p.proconfig = array['search_path=""']
                  and not has_function_privilege('authenticated', p.oid, 'execute')
                  and not has_function_privilege('anon', p.oid, 'execute')
             from pg_proc p
            where p.oid = to_regprocedure('public.record_deleted_session()'))
            as trigger_function_is_the_migration,
          exists (select 1 from pg_trigger
                   where tgname = 'sessions_record_deleted'
                     and tgrelid = 'public.sessions'::regclass
                     and tgenabled <> 'D' and not tgisinternal) as trigger_is_on,
          case when to_regclass('public.deleted_sessions') is null then false
               else (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.deleted_sessions'))
                    and has_table_privilege('authenticated', 'public.deleted_sessions', 'select')
                    and not has_table_privilege('authenticated', 'public.deleted_sessions', 'insert, update, delete')
                    and not has_table_privilege('anon', 'public.deleted_sessions', 'select, insert, update, delete')
          end as tombstones_are_read_only_to_riders,
          exists (select 1 from pg_policies p
            where p.schemaname = 'public' and p.tablename = 'deleted_sessions'
              and p.policyname = 'deleted_sessions: select own' and p.cmd = 'SELECT'
              and p.permissive = 'PERMISSIVE' and p.qual = '(auth.uid() = user_id)') as tombstone_policy_is_select_own,
          (select count(*) from pg_policies p
            where p.schemaname = 'public' and p.tablename = 'deleted_sessions') as tombstone_policies,
          (select count(*) from pg_policies p
            where p.schemaname = 'public' and p.tablename = 'sessions'
              and p.policyname in ('sessions: insert own', 'sessions: update own')
              and p.qual is not distinct from case p.cmd when 'UPDATE' then '(auth.uid() = user_id)' end
              and md5(replace(p.with_check, 'public.vehicles', 'vehicles')) = '${SESSION_VEHICLE_OWNED_CHECK_MD5}')
            as vehicle_checked_session_policies,
          (select count(*) from pg_policies p
            where p.schemaname = 'public' and p.tablename = 'sessions') as session_policies;
      `),
    );
  });

  it('rolls back to 20260927002200 and the baseline policies, in one transaction', () => {
    const rollback = fencedBlock(runbook, ROLLBACK_MARKER);

    expect(statements(rollback)).toEqual([
      'begin',
      ...statements(previous),
      'alter policy "sessions: insert own" on public.sessions with check (auth.uid() = user_id)',
      'alter policy "sessions: update own" on public.sessions using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      'drop trigger if exists sessions_record_deleted on public.sessions',
      'drop function if exists public.record_deleted_session()',
      'drop table if exists public.deleted_sessions',
      'commit',
    ]);
    // Byte for byte, so the restored function fingerprints as 20260927002200
    // and that section's own verify query reads true again.
    expect(dollarBodies(rollback)).toEqual(dollarBodies(previous));
  });
});
