Migrations that exist only to be generated against. `buildAuditSql` is pointed
at this directory so the derivation can be watched moving when a file is added
and failing when one has no probe - neither of which can be shown against
`supabase/migrations/`, where every file is already correct.

Nothing applies these. They are outside `supabase/migrations/`, so no Supabase
command sees them, exactly like `tests/fixtures/migration-guard/`.
