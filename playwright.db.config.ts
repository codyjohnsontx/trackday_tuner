import { loadEnvConfig } from '@next/env';
import { defineConfig } from '@playwright/test';
import { nonLocalSupabaseUrlReason } from './tests/db/helpers/local-stack';

/**
 * The real-database suite: `tests/db/`, run by `npm run test:db` and by CI on
 * every pull request against a local Supabase stack built from
 * `supabase/migrations/`.
 *
 * Nothing here opens a browser or needs a dev server - each spec signs a rider
 * in with the anon key and calls the database, or the server code that writes
 * to it, as that rider. So there is one project and no `webServer`.
 *
 * A suite that skips reports green, which is the one outcome a gate must never
 * reach by accident: without a stack to talk to, this config refuses to run
 * rather than letting every spec skip itself. It also refuses any stack that is
 * not on loopback, since the specs create and delete riders.
 */
loadEnvConfig(process.cwd());

const REQUIRED = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`test:db needs a Supabase stack: set ${missing.join(', ')} (see TESTING.md).`);
}
// The suite creates and deletes Auth users with the service role, so it runs
// against a stack on this machine and never a hosted project.
const nonLocal = nonLocalSupabaseUrlReason(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (nonLocal) {
  throw new Error(`test:db only runs against a local Supabase stack: ${nonLocal} (see TESTING.md).`);
}

export default defineConfig({
  testDir: './tests/db',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  projects: [{ name: 'database' }],
});
