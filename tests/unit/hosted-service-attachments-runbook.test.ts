import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The generator is plain JS with no types (see migration-audit-generation.test.ts).
// @ts-expect-error - see above.
import { functionBodyMd5 } from '@/scripts/build-migration-audit.mjs';
import { bucketsDeclaredIn } from './helpers/storage-buckets';

// docs/beta-runbook.md carries a copy of 20261014000400 for the hosted project,
// which has no migration history and is patched in the SQL editor by hand, plus
// the private bucket supabase/config.toml declares. A copy that lost the per-book
// lock would let two uploads take the last free slot; one that lost a revoke
// would let anybody reserve; a bucket created public would serve every receipt to
// anyone holding its path.
//
// Text only, like its twins: the runbook's verification query is what answers
// whether the block ran.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '../..');
const MIGRATION = '20261014000400_add_service_attachments';
const migration = readFileSync(path.join(root, `supabase/migrations/${MIGRATION}.sql`), 'utf8');
const config = readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const runbook = readFileSync(path.join(root, 'docs/beta-runbook.md'), 'utf8');

const BLOCK_MARKER = `-- hosted-service-attachments: mirror of supabase/migrations/${MIGRATION}.sql`;
const VERIFY_MARKER = '-- hosted-service-attachments-verify';
const ROLLBACK_MARKER = '-- hosted-service-attachments-rollback';

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

describe('the hosted service attachments block in docs/beta-runbook.md', () => {
  const block = statements(fencedBlock(runbook, BLOCK_MARKER));

  it('is the migration statement for statement, then the bucket, inside one transaction', () => {
    expect(block[0]).toBe('begin');
    expect(block[block.length - 1]).toBe('commit');
    expect(block.slice(1, -2)).toEqual(statements(migration));
  });

  it('creates the bucket private, with the size and types supabase/config.toml declares', () => {
    const declared = bucketsDeclaredIn(config).find((bucket) => bucket.name === 'service-book');
    expect(declared).toEqual({ name: 'service-book', public: false, allowedMimeTypes: ['image/jpeg', 'application/pdf'] });
    expect(config).toMatch(/\[storage\.buckets\.service-book\]\npublic = false\nfile_size_limit = "25MiB"\n/);

    const mimeTypes = declared!.allowedMimeTypes!.map((type) => `'${type}'`).join(', ');
    expect(block[block.length - 2]).toBe(
      `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('service-book', 'service-book', false, ${25 * 1024 * 1024}, array[${mimeTypes}]) on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types`,
    );
  });

  it('verifies every function body the migration ships, by its md5', () => {
    const verify = fencedBlock(runbook, VERIFY_MARKER);
    for (const name of [
      'reserve_service_attachment',
      'confirm_service_attachment',
      'service_attachment_allowance',
      'purge_stale_service_attachments',
    ]) {
      expect(verify, name).toContain(`'${functionBodyMd5(MIGRATION, name)}'`);
    }
  });

  it('keeps the rollback a transaction that unschedules the sweep and drops only what the migration made', () => {
    expect(statements(fencedBlock(runbook, ROLLBACK_MARKER))).toEqual([
      'begin',
      "select cron.unschedule('purge-stale-service-attachments')",
      'drop function if exists public.purge_stale_service_attachments()',
      'drop function if exists public.confirm_service_attachment(uuid)',
      'drop function if exists public.reserve_service_attachment(uuid, uuid, text, text, integer)',
      'drop function if exists public.service_attachment_allowance()',
      'drop table if exists public.service_attachments',
      'commit',
    ]);
  });
});
