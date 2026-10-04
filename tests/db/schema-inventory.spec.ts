import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

/**
 * The schema inventory the owner runs against the hosted project
 * (`scripts/sql/schema-inventory.sql`), run against a real database built from
 * supabase/migrations, and `npm run db:drift` comparing a saved copy of it with
 * that database the way it compares the hosted download.
 *
 * Both go through `supabase db query --local`, the path the drift checker takes
 * for its reference, which targets the stack `supabase/config.toml` names rather
 * than the URL this suite was handed. In CI that is the one stack.
 *
 * The one write is a probe function standing in for a migration the hosted
 * project never received, dropped again however the test ends.
 */

const ROOT = path.resolve(__dirname, '../..');
const INVENTORY = path.join(ROOT, 'scripts/sql/schema-inventory.sql');
const PROBE = 'schema_drift_probe';
// The installed CLI rather than `npx`, which spends seconds resolving it per call.
const SUPABASE = path.join(ROOT, 'node_modules/.bin/supabase');

// Every inventory is a CLI start and a catalogue read, and the drift test makes
// six of those calls.
test.describe.configure({ timeout: 180_000 });

function supabaseQuery(...args: string[]): string {
  const result = spawnSync(SUPABASE, ['db', 'query', '--local', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`supabase db query failed: ${result.stderr}`);
  return result.stdout;
}

function inventoryCsv(): string {
  return supabaseQuery('-f', INVENTORY, '-o', 'csv');
}

function drift(hostedCsv: string) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts/schema-drift.mjs'), hostedCsv], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

test('the inventory runs as one statement, and runs the same twice', () => {
  const first = inventoryCsv();

  expect(inventoryCsv()).toBe(first);
  // The kinds of object the hosted drift was made of, so the inventory is known
  // to print each of them at all. A quoted CSV field starts with `"`.
  const lines = first.split('\n').map((line) => line.replace(/^"/, ''));
  for (const prefix of [
    'COLUMN public.profiles.beta_access_expires_at ',
    'FUNCTION public.save_session_outcome(',
    'FUNCGRANT public.save_session_outcome(',
    'TRIGGER auth.users on_auth_user_created ',
    'POLICY storage.objects vehicle-photos: insert own ',
    'BUCKET vehicle-photos ',
    'TABLE public.ai_replay_export kind=view owner=postgres options=security_invoker=true',
  ]) {
    expect(lines.some((line) => line.startsWith(prefix)), prefix).toBe(true);
  }
});

test('a database missing a migration reads as drift naming what it lacks', () => {
  // The "hosted" download is this database before the probe; the reference is
  // the same database after it, the way a migration hosted never received leaves
  // the repository one function ahead.
  const hosted = path.join(mkdtempSync(path.join(tmpdir(), 'schema-drift-')), 'hosted.csv');
  writeFileSync(hosted, inventoryCsv());

  try {
    supabaseQuery(`create function public.${PROBE}() returns integer language sql as 'select 1'`);
    const behind = drift(hosted);

    expect(behind.status, behind.stderr).toBe(1);
    expect(behind.stdout).toContain(`  - FUNCGRANT public.${PROBE}() <default acl: EXECUTE to PUBLIC>`);
    expect(behind.stdout).toMatch(new RegExp(`  - FUNCTION public\\.${PROBE}\\(\\) returns=integer `));
    expect(behind.stdout).not.toMatch(/^ {2}[-+] (?!FUNC(?:TION|GRANT) public\.schema_drift_probe\(\))/m);
  } finally {
    supabaseQuery(`drop function if exists public.${PROBE}()`);
  }

  const caughtUp = drift(hosted);
  expect(caughtUp.status, caughtUp.stdout + caughtUp.stderr).toBe(0);
  expect(caughtUp.stdout).toMatch(/^No drift/);
});
