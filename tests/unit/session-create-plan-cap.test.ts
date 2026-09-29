import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveUserAccess } from '@/lib/access';
import { getFreePlanLimit } from '@/lib/plans';
import type { Profile } from '@/types';

// A STRUCTURAL GUARD, NOT BEHAVIOURAL PROOF. `create_session_with_laps` counts a
// free rider's sessions under its per-rider lock (20260928002300), so the cap
// and the entitlement that lifts it are written in SQL as well as in
// lib/plans.ts and lib/access.ts. This reads the newest definition of the
// function as text so a change to either copy that leaves the other behind fails
// in the required checks, where the real-database spec does not run. It cannot
// show the SQL behaves as written: tests/e2e/create-session-with-laps.spec.ts is
// what runs the function at the cap for every entitlement case below and checks
// it against resolveUserAccess.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDir = path.join(root, 'supabase/migrations');

function latestCreateSessionBody(): { file: string; body: string } {
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files.reverse()) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    const match = /create or replace function public\.create_session_with_laps\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/.exec(sql);
    if (match) return { file, body: match[1] };
  }
  throw new Error('no migration defines public.create_session_with_laps');
}

const { file, body } = latestCreateSessionBody();

describe(`the SQL and TypeScript copies of the free-plan session cap (${file})`, () => {
  it('spell the same cap as lib/plans.ts', () => {
    const cap = /\(select count\(\*\) from public\.sessions s where s\.user_id = auth\.uid\(\)\) >= (\d+) then/.exec(body);
    expect(cap, 'the count clause moved; update this test with it').not.toBeNull();
    expect(Number(cap![1])).toBe(getFreePlanLimit('sessions'));
  });

  it('spell the same entitlement as lib/access.ts', () => {
    const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
    expect(squash(body)).toContain(
      squash(`
        select p.tier = 'pro'
               or (p.beta_access_expires_at > now()
                   and (p.beta_access_started_at is null or p.beta_access_started_at <= now()))
          into v_unlimited
          from public.profiles p
         where p.id = auth.uid();
      `),
    );
    expect(squash(body)).toContain('if not coalesce(v_unlimited, false)');
  });

  // The cases the entitlement text above encodes, asked of the TypeScript rule.
  // A change to resolveUserAccess that moves one of these has left the SQL copy
  // behind, so it fails here and sends the reader to the migration.
  it.each<[string, Partial<Profile> | null, boolean]>([
    ['no profile row', null, false],
    ['the free tier', { tier: 'free' }, false],
    ['Pro', { tier: 'pro' }, true],
    ['Pro with a beta window long over', { tier: 'pro', beta_access_expires_at: '2000-01-01T00:00:00Z' }, true],
    ['a beta window open with no start', { tier: 'free', beta_access_expires_at: '2999-01-01T00:00:00Z' }, true],
    [
      'a beta window that has started',
      { tier: 'free', beta_access_started_at: '2000-01-01T00:00:00Z', beta_access_expires_at: '2999-01-01T00:00:00Z' },
      true,
    ],
    [
      'a beta window not yet started',
      { tier: 'free', beta_access_started_at: '2998-01-01T00:00:00Z', beta_access_expires_at: '2999-01-01T00:00:00Z' },
      false,
    ],
    ['a beta window that has expired', { tier: 'free', beta_access_expires_at: '2000-01-01T00:00:00Z' }, false],
  ])('keep %s where the SQL copy puts it', (_label, profile, unlimited) => {
    const full = profile
      ? ({ beta_access_started_at: null, beta_access_expires_at: null, ...profile } as Profile)
      : null;
    expect(resolveUserAccess(full).hasProAccess).toBe(unlimited);
  });
});
