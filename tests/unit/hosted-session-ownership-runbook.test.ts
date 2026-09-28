import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The generator is plain JS with no types (see migration-audit-generation.test.ts).
import {
  SESSION_OWNERSHIP_POLICIES_EXACT,
  SESSION_OWNERSHIP_POLICIES_TOTAL,
  SESSION_TOMBSTONE_TRIGGER_EXACT,
  SESSION_VEHICLE_OWNED_CHECK_MD5,
  buildAuditSql,
  functionBodyMd5,
  // @ts-expect-error - see above.
} from '@/scripts/build-migration-audit.mjs';

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

  // Written out in full rather than rebuilt from the exported fragments, so
  // loosening a check - dropping the trigger's event or level, a policy's
  // command, role or `using` - fails here whether it was loosened in the
  // runbook or in scripts/build-migration-audit.mjs. Each clause was watched
  // catching its drift on a real database: see the PR's negative cases.
  it('verifies both bodies, the exact trigger, the tombstone table and every policy tuple', () => {
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
          (exists (select 1 from pg_trigger t
                    where t.tgrelid = to_regclass('public.sessions')
                      and t.tgname = 'sessions_record_deleted'
                      and t.tgfoid = to_regprocedure('public.record_deleted_session()')
                      and t.tgtype = 9
                      and t.tgenabled = 'O'
                      and t.tgnargs = 0
                      and t.tgqual is null
                      and not t.tgisinternal)
           and (select count(*) from pg_trigger t
                 where t.tgfoid = to_regprocedure('public.record_deleted_session()')) = 1)
            as trigger_is_exact,
          case when to_regclass('public.deleted_sessions') is null then false
               else (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.deleted_sessions'))
                    and has_table_privilege('authenticated', 'public.deleted_sessions', 'select')
                    and not has_table_privilege('authenticated', 'public.deleted_sessions', 'insert, update, delete')
                    and not has_table_privilege('anon', 'public.deleted_sessions', 'select, insert, update, delete')
          end as tombstones_are_read_only_to_riders,
          (select count(*) from pg_policies p
             join (values
               ('sessions', 'sessions: select own', 'SELECT', '(auth.uid() = user_id)', null),
               ('sessions', 'sessions: insert own', 'INSERT', null, '${SESSION_VEHICLE_OWNED_CHECK_MD5}'),
               ('sessions', 'sessions: update own', 'UPDATE', '(auth.uid() = user_id)', '${SESSION_VEHICLE_OWNED_CHECK_MD5}'),
               ('sessions', 'sessions: delete own', 'DELETE', '(auth.uid() = user_id)', null),
               ('deleted_sessions', 'deleted_sessions: select own', 'SELECT', '(auth.uid() = user_id)', null)
             ) as e(tablename, policyname, cmd, qual, with_check_md5)
               on e.tablename = p.tablename and e.policyname = p.policyname
            where p.schemaname = 'public'
              and p.cmd = e.cmd
              and p.permissive = 'PERMISSIVE'
              and p.roles = array['public']::name[]
              and p.qual is not distinct from e.qual
              and md5(replace(p.with_check, 'public.vehicles', 'vehicles')) is not distinct from e.with_check_md5)
            as exact_policies,
          (select count(*) from pg_policies p
            where p.schemaname = 'public' and p.tablename in ('sessions', 'deleted_sessions'))
            as all_policies;
      `),
    );
  });

  it('generates the same trigger and policy checks into audit row 26', () => {
    const verify = statements(fencedBlock(runbook, VERIFY_MARKER)).join(' ');
    const audit = statements(buildAuditSql()).join(' ');
    const squash = (lines: string[]) => statements(lines.join('\n')).join(' ');
    for (const fragment of [SESSION_TOMBSTONE_TRIGGER_EXACT, SESSION_OWNERSHIP_POLICIES_EXACT, SESSION_OWNERSHIP_POLICIES_TOTAL]) {
      expect(verify).toContain(squash(fragment));
      expect(audit).toContain(squash(fragment));
    }
    expect(audit).toContain(`${squash(SESSION_OWNERSHIP_POLICIES_EXACT)} = 5`);
    expect(audit).toContain(`${squash(SESSION_OWNERSHIP_POLICIES_TOTAL)} = 5`);
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
