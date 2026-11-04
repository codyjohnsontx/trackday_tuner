---
name: trackday-monitoring
description: "Use when changing trackday_tuner error reporting, health checks, schema monitoring, RAG bundling, or AI status monitoring."
---

## Production Monitoring

`docs/monitoring.md` is the runbook: what each piece catches, the three alert
channels, the wiring checklist, and the known limits. Four facts belong here
because they change how ordinary code is written.

**A handled error never reaches Sentry on its own.** Next's `onRequestError`
(`instrumentation.ts`) sees only *unhandled* errors, and almost nothing in this
app is unhandled - both AI routes catch, write the `ai_requests` audit row and
return a shaped JSON 500, and the health checks catch so the probe can name the
failing one. R3 (053c545) ran through `tuning-advice`'s catch on every call for
three months and that catch logged nothing at all, so installing the SDK alone
would have watched the whole outage and reported nothing. **A catch block that
swallows a failure calls `reportError` (`lib/monitoring/report-error.ts`)**,
which logs first - `console.error` is the only channel that works with no DSN,
and it is what a log drain indexes.

**A new route that can reach `lib/rag/retriever` needs its own
`outputFileTracingIncludes` entry in `next.config.ts`.** Each serverless
function is its own bundle, so an entry for one route says nothing about
another's copy of `data/rag-index.json`.
`tests/unit/rag-index-bundling.test.ts` walks the first-party import graph of
every API route and names any that is missing one.

**NOTHING APPLIES MIGRATIONS AUTOMATICALLY, so a deploy can put code in front of
a database that has not got the schema it needs.** `npm run db:push` is a person
at a terminal; no workflow runs it and there is no `vercel.json`. Pages still
render, and the first anyone hears of it is a rider losing what they typed -
`save_session_outcome` was missing in production and Save Outcome answered
`PGRST202 Could not find the function ... in the schema cache` with the notes
unsaved. `/api/health`'s `schema_contract` check
(`lib/monitoring/schema-contract.ts`) is what says so now, within fifteen
minutes, and **a new `supabase.rpc()` call site belongs on its list** or the
check reports healthy while that feature is the one that is broken.
`tests/unit/rpc-call-sites.test.ts` is what holds that rule - it sweeps `app/`
and `lib/` and fails naming any RPC the list does not carry, so this paragraph
is the reason rather than the enforcement.

It asks the Data API rather than `pg_proc` on purpose, and this is the fact worth
carrying: **a never-applied migration and a stale PostgREST schema cache are
byte-identical from a client** - same 404, same `PGRST202`, same message, same
null `hint` (measured). A catalog check would call the stale-cache case healthy
while every save failed. What the neighbouring faults answer instead, also
measured, is what makes an error report worth reading: a missing `execute` grant
is `403` / `42501`, and a signature that drifted by one parameter is `PGRST202`
*with* a `hint` naming the signature it did find. `scripts/sql/audit-migrations-against-database.sql`
reports every migration against a live schema in one read-only query - use it
rather than `npm run db:status`, which reads a CLI history the hosted project
has never had. **It is GENERATED** by `scripts/build-migration-audit.mjs` from
`supabase/migrations/` (`npm run db:audit`), because a hand-kept list of rows
reports the migration it never heard of as present - the audit answering its own
question wrongly. Adding a migration means adding its probe there; generation
fails naming the file until you do. The audit sees one sentinel per migration;
`scripts/sql/schema-inventory.sql` is the whole schema, one object per line, and
`npm run db:drift -- <hosted.csv>` diffs the hosted download against a local stack
built from the migrations - "Check the hosted schema for drift" in
`docs/beta-runbook.md`.

**`/api/monitoring/ai-health` reads `ai_requests` and every status has to be
classified.** Refusals, rate limiting and duplicate suppression are not
failures; an unrecognised status is treated as one, deliberately, because a
monitor that reads what it does not understand as healthy is the defect it
exists to catch. Adding a status to `updateRequestLog` means classifying it in
`lib/monitoring/ai-health.ts`.

