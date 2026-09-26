import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// docs/beta-runbook.md carries a copy of 20260927002000 for the hosted project,
// which has no migration history and is patched in the SQL editor by hand - the
// arrangement its twins guard for the tables this view reads. A copy that lost
// the opt-in arm, the retain_until filter or the revoke would export text a
// rider never agreed to share, or hand the view to anon.
//
// Text only, like its twins: the runbook's verification query is what answers
// whether the block ran.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const migration = readFileSync(
  path.join(root, 'supabase/migrations/20260927002000_add_ai_replay_export_view.sql'),
  'utf8',
);
const runbook = readFileSync(path.join(root, 'docs/beta-runbook.md'), 'utf8');

const BLOCK_MARKER =
  '-- hosted-ai-replay-export: mirror of supabase/migrations/20260927002000_add_ai_replay_export_view.sql';
const ROLLBACK_MARKER = '-- hosted-ai-replay-export-rollback';

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

describe('the hosted replay export block in docs/beta-runbook.md', () => {
  it('is the migration statement for statement, in its order, inside one transaction', () => {
    const block = statements(fencedBlock(runbook, BLOCK_MARKER));

    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    expect(block.slice(1, -1)).toEqual(statements(migration));
  });

  // The precheck and the verify each decide whether the view on the database is
  // this migration's by one `case` over a hash of its definition. Two copies of
  // that expression that disagree would let one step bless what the other
  // stops on; the hash itself is proved against a stack, since only Postgres
  // can render a view.
  it('decides the view definition identically in the precheck and the verify', () => {
    const section = runbook.slice(
      runbook.indexOf('### Apply the replay export view by hand'),
      runbook.indexOf('## Invite a Rider'),
    );
    const decisions = [...section.matchAll(/case\s+when to_regclass\('public\.ai_replay_export'\) is null[\s\S]*?\bend\b/g)].map(
      (match) => match[0].replace(/\s+/g, ' '),
    );

    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toBe(decisions[1]);
    expect(decisions[0]).toMatch(/md5\(regexp_replace\(pg_get_viewdef\(to_regclass\('public\.ai_replay_export'\)\)/);
    expect(decisions[0]).toContain("array['security_invoker=true']");
  });

  it('keeps the rollback to dropping the view', () => {
    expect(statements(fencedBlock(runbook, ROLLBACK_MARKER))).toEqual([
      'drop view if exists public.ai_replay_export',
    ]);
  });
});
