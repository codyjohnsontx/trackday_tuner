import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The generator is plain JS with no types (see migration-audit-generation.test.ts).
// @ts-expect-error - see above.
import { functionBodyMd5 } from '@/scripts/build-migration-audit.mjs';

// docs/beta-runbook.md carries a copy of 20261004002700 for the hosted project,
// which is patched in the SQL editor by hand. A copy that drifted from the
// migration - one that stopped reading the verified claim, or dropped the
// existing-identity condition - would read as applied and gate nothing, so the
// apply, verify and rollback are all pinned to the migration. The precheck is
// run against a real database in tests/db/unverified-identity-link.spec.ts.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const MIGRATION = '20261004002700_refuse_unverified_identity_link';
const migration = readFileSync(path.join(root, `supabase/migrations/${MIGRATION}.sql`), 'utf8');
const runbook = readFileSync(path.join(root, 'docs/beta-runbook.md'), 'utf8');

const BLOCK_MARKER = `-- hosted-unverified-identity-link: mirror of supabase/migrations/${MIGRATION}.sql`;
const VERIFY_MARKER = '-- hosted-unverified-identity-link-verify';
const ROLLBACK_MARKER = '-- hosted-unverified-identity-link-rollback';

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

describe('the hosted unverified identity link block in docs/beta-runbook.md', () => {
  it('is the migration statement for statement, in its order, inside one transaction', () => {
    const block = statements(fencedBlock(runbook, BLOCK_MARKER));

    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    expect(block.slice(1, -1)).toEqual(statements(migration));
  });

  it('carries the function body byte for byte, so the pasted function fingerprints as the migration', () => {
    const bodies = dollarBodies(migration);
    expect(bodies).toHaveLength(1);
    expect(dollarBodies(fencedBlock(runbook, BLOCK_MARKER))).toEqual(bodies);
  });

  it('verifies the trigger by its enabled state, security, search path, grants and body fingerprint', () => {
    expect(statements(fencedBlock(runbook, VERIFY_MARKER))).toEqual(
      statements(`
        select
          t.tgenabled <> 'D' as trigger_enabled,
          p.prosecdef as security_definer,
          p.proconfig as settings,
          has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
          has_function_privilege('authenticated', p.oid, 'execute') as rider_can_execute,
          md5(p.prosrc) = '${functionBodyMd5(MIGRATION)}' as definition_is_the_migration
        from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
        where t.tgname = 'refuse_unverified_identity_link'
          and t.tgrelid = 'auth.identities'::regclass;
      `),
    );
  });

  it('rolls back by dropping the trigger and then its function', () => {
    expect(statements(fencedBlock(runbook, ROLLBACK_MARKER))).toEqual([
      'begin',
      'drop trigger if exists refuse_unverified_identity_link on auth.identities',
      'drop function if exists public.refuse_unverified_identity_link()',
      'commit',
    ]);
  });
});
