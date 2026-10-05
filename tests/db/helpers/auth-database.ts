import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Run SQL against the local stack's database as `supabase_auth_admin`, the role
 * GoTrue writes the `auth` schema as.
 *
 * The rest of the suite reaches the database through the Data API, which cannot
 * write `auth.identities`. A guard on that table can only be exercised by
 * writing to it the way GoTrue does, so this goes through `psql` inside the
 * stack's own database container - no client library, and nothing that works
 * against anything but a stack `supabase start` built on this machine.
 *
 * The container is `supabase_db_<project_id>` from supabase/config.toml, which is
 * what both a developer's stack and CI's are called; set SUPABASE_DB_CONTAINER
 * to point at a stack started from another workdir.
 */
export interface SqlResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function databaseContainer(): string {
  if (process.env.SUPABASE_DB_CONTAINER) return process.env.SUPABASE_DB_CONTAINER;
  const config = readFileSync(path.join(process.cwd(), 'supabase/config.toml'), 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  if (!projectId) throw new Error('supabase/config.toml has no project_id');
  return `supabase_db_${projectId}`;
}

/** Runs `sql` in one transaction, so a statement that raises leaves nothing behind. */
export function runAsAuthAdmin(sql: string): SqlResult {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      databaseContainer(),
      'psql',
      'postgresql://supabase_auth_admin:postgres@127.0.0.1:5432/postgres',
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--single-transaction',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: sql, encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}
