import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { nonLocalSupabaseUrlReason } from '@/tests/db/helpers/local-stack';

// `npm run test:db` creates and deletes Auth users with the service role, and its
// config loads the app's env files, so it must refuse to aim at a hosted
// project. These run the real config through Playwright's own loader.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function listDbSuite(url: string) {
  return spawnSync('npx', ['playwright', 'test', '--config=playwright.db.config.ts', '--list'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    },
  });
}

describe('the real-database suite only runs against a local stack', () => {
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321'])('accepts %s', (url) => {
    expect(nonLocalSupabaseUrlReason(url)).toBeNull();
  });

  it.each([
    'https://abcdefghijklmno.supabase.co',
    'https://example.invalid',
    'http://127.0.0.1.example.com:54321',
    'not a url',
    undefined,
  ])('refuses %s', (url) => {
    expect(nonLocalSupabaseUrlReason(url)).not.toBeNull();
  });

  it('refuses to list the suite against a hosted URL, and lists it against a local one', () => {
    const hosted = listDbSuite('https://abcdefghijklmno.supabase.co');
    const local = listDbSuite('http://127.0.0.1:54321');

    expect(hosted.status).not.toBe(0);
    expect(hosted.stdout + hosted.stderr).toMatch(/only runs against a local Supabase stack/);
    expect(local.status, local.stderr).toBe(0);
    expect(local.stdout).toMatch(/Total: \d+ tests? in \d+ files?/);
  }, 60_000);
});
