# migration-guard fixtures

SQL that is deliberately wrong, and SQL that is deliberately right, fed to the
analysis in `tests/unit/migrations-bootstrap.test.ts` as if it were a migration.

These files are **not** migrations. They live outside `supabase/migrations/` so
`supabase start`, `supabase db push` and `npm run db:status` never see them. The
guard's own tests are the only thing that reads them.

A fixture exists so the guard can be watched failing. `20260719001100_grant_data_api_access.sql`
already carries a correct `revoke` / `grant execute` pair, so running the guard
only against the real migrations proves nothing about what it would do to a
migration that got it wrong - it would pass just as happily if the check were
deleted.

Each filename says what it is. The three role spellings - `anon`,
`authenticated` and `public` - are covered separately because `public` is the
one the real migrations revoke from, and the one the guard used to miss.
