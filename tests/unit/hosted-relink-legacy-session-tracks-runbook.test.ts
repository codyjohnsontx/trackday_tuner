import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The generator is plain JS with no types (see migration-audit-generation.test.ts).
// @ts-expect-error - see above.
import { functionBodyMd5 } from '@/scripts/build-migration-audit.mjs';

// docs/beta-runbook.md carries a copy of 20261004002600 for the hosted project,
// which is patched in the SQL editor by hand - the arrangement
// hosted-track-reference-check-runbook.test.ts guards for the migration before it.
// The copy is split in two: the apply block installs the function, and the run
// block is the migration's last statement on its own, so the editor shows the
// report the rollback is filled from. Together they have to be the migration.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const MIGRATION = '20261004002600_relink_legacy_session_tracks';
const migration = readFileSync(path.join(root, `supabase/migrations/${MIGRATION}.sql`), 'utf8');
const runbook = readFileSync(path.join(root, 'docs/beta-runbook.md'), 'utf8');

const BLOCK_MARKER = `-- hosted-relink-legacy-session-tracks: mirror of supabase/migrations/${MIGRATION}.sql`;
const RUN_MARKER = '-- hosted-relink-legacy-session-tracks-run';
const VERIFY_MARKER = '-- hosted-relink-legacy-session-tracks-verify';
const ROLLBACK_MARKER = '-- hosted-relink-legacy-session-tracks-rollback';

const STILL_UNLINKED =
  "(select count(*) from public.sessions s where s.track_id is null and nullif(btrim(s.track_name), '') is not null)";

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

describe('the hosted relink block in docs/beta-runbook.md', () => {
  it('is the migration statement for statement: the apply block in one transaction, then the run block', () => {
    const block = statements(fencedBlock(runbook, BLOCK_MARKER));
    const run = statements(fencedBlock(runbook, RUN_MARKER));

    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    expect([...block.slice(1, -1), ...run]).toEqual(statements(migration));
    expect(run).toEqual(['select * from public.relink_legacy_session_tracks()']);
  });

  it('carries the function body byte for byte, so the pasted function fingerprints as the migration', () => {
    const bodies = dollarBodies(migration);
    expect(bodies).toHaveLength(1);
    expect(dollarBodies(fencedBlock(runbook, BLOCK_MARKER))).toEqual(bodies);
  });

  it('verifies security, search path, service_role-only execute, body fingerprint and what is left', () => {
    expect(statements(fencedBlock(runbook, VERIFY_MARKER))).toEqual(
      statements(`
        select
          p.prosecdef as security_definer,
          p.proconfig as settings,
          has_function_privilege('service_role', p.oid, 'execute') as service_role_can_execute,
          has_function_privilege('authenticated', p.oid, 'execute') as rider_can_execute,
          has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
          md5(p.prosrc) = '${functionBodyMd5(MIGRATION)}' as definition_is_the_migration,
          ${STILL_UNLINKED} as sessions_still_unlinked
        from pg_proc p
        where p.oid = to_regprocedure('public.relink_legacy_session_tracks(uuid)');
      `),
    );
  });

  it('rolls back only the sessions still where the relink put them, then drops the function', () => {
    expect(statements(fencedBlock(runbook, ROLLBACK_MARKER))).toEqual([
      'begin',
      'update public.sessions s set track_id = null from (values ) as r(session_id, track_id) where s.id = r.session_id and s.track_id = r.track_id',
      'drop function if exists public.relink_legacy_session_tracks(uuid)',
      'commit',
    ]);
  });
});
