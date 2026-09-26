import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// docs/beta-runbook.md carries a copy of 20260926002000 for the hosted project,
// which has no migration history and is patched in the SQL editor by hand - the
// arrangement tests/unit/hosted-capture-keep-rule-runbook.test.ts guards for the
// migration before it. A copy that lost `auth.uid()` from one policy would let any
// rider overwrite any other rider's session photo.
//
// The block also creates the bucket, which on a CLI-built project comes from
// `[storage.buckets.session-photos]` in supabase/config.toml rather than from the
// migration, so that one statement is pinned here against the same settings.
//
// Text only, like its twins: the runbook's verification query is what answers
// whether the block ran.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const migration = readFileSync(
  path.join(root, 'supabase/migrations/20260926002000_add_session_photos.sql'),
  'utf8',
);
const config = readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const runbook = readFileSync(path.join(root, 'docs/beta-runbook.md'), 'utf8');

const BLOCK_MARKER =
  '-- hosted-session-photos: mirror of supabase/migrations/20260926002000_add_session_photos.sql';
const ROLLBACK_MARKER = '-- hosted-session-photos-rollback';

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

describe('the hosted session photos block in docs/beta-runbook.md', () => {
  const block = statements(fencedBlock(runbook, BLOCK_MARKER));

  it('is the migration statement for statement, then the bucket, inside one transaction', () => {
    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    expect(block.slice(1, -2)).toEqual(statements(migration));
  });

  it('creates the bucket with the settings supabase/config.toml declares', () => {
    const declared = /^\[storage\.buckets\.session-photos\]\n((?:(?!\[)[^\n]*\n)*)/m.exec(config)?.[1];
    expect(declared).toContain('public = true');
    expect(declared).toContain('allowed_mime_types = ["image/*"]');

    expect(block[block.length - 2]).toBe(
      "insert into storage.buckets (id, name, public, allowed_mime_types) values ('session-photos', 'session-photos', true, array['image/*']) on conflict (id) do update set public = excluded.public, allowed_mime_types = excluded.allowed_mime_types",
    );
  });

  it('keeps the rollback a transaction that removes the policies and the column', () => {
    expect(statements(fencedBlock(runbook, ROLLBACK_MARKER))).toEqual([
      'begin',
      'drop policy if exists "session-photos: select own" on storage.objects',
      'drop policy if exists "session-photos: insert own" on storage.objects',
      'drop policy if exists "session-photos: update own" on storage.objects',
      'drop policy if exists "session-photos: delete own" on storage.objects',
      'alter table public.sessions drop column if exists photo_url',
      'commit',
    ]);
  });
});
