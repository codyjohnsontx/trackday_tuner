---
name: trackday-database
description: "Use when changing or diagnosing trackday_tuner database migrations, RLS, grants, functions, storage schema, or hosted schema drift."
---

## Database Migrations

Migrations live in `supabase/migrations/` and are applied with the Supabase CLI
against the linked hosted project. `supabase_migrations.schema_migrations` on
the remote is the source of truth for what has been applied.
A hosted project may carry no CLI-tracked history at all - on 2026-08-25 the
live project had no `supabase_migrations.schema_migrations` table - and then the
bullets below, and the note further down that the baseline is dated before
migrations the remote has already recorded, apply only once it is brought under
CLI management; until then see "A migration in this repository is not evidence
the hosted project has it" under the grants notes below and "Apply the Data API
grants by hand" in `docs/beta-runbook.md`.

- `npm run db:status` before and after any schema work. It compares the applied
  migration *history* — which versions the remote has recorded — against the
  files in `supabase/migrations/`. Three migrations were once applied by hand
  and silently skipped, which surfaced months later as `PGRST202 Could not find
  the function public.replace_session_laps` when a rider saved lap times
- `db:status` cannot see changes made outside a migration, so a table altered by
  hand in the dashboard still reads as "up to date". Use
  `npx supabase db diff --linked` for that: it diffs the live schema against
  what the migration files describe and prints the SQL that would reconcile
  them. Empty output means no difference *the diff engine models* was found —
  not that the two are identical. The comparison is done by a pluggable engine
  (`--use-migra`, `--use-pgadmin`, `--use-pg-schema`, `--use-pg-delta`), and
  coverage varies between them. Publications, storage buckets, and
  `security_invoker` on views are known to slip through, so anything in that
  territory still needs checking by hand
- **Never edit a migration that has already been applied.** The remote records
  it by version, so an edit changes the file without changing the database and
  `db push` will never re-run it. Corrections go in a new migration.
  **This includes comments.** A comment-only edit looks obviously safe, and that
  is the problem: the rule survives because nobody has to judge whether a given
  edit is harmless, and it stops working the moment the first exception is
  granted. A stale comment in an applied file is corrected *here*, in this
  document, next to the migration notes that explain it - see the note on the
  baseline's `profiles` comment below
- Filenames are `<14-digit timestamp>_<name>.sql`. The timestamp is the version
  recorded remotely and is a primary key, so **two migrations must never share a
  prefix** — an earlier pair both named `20260224_` could not both be recorded
- A new migration also needs a probe in `scripts/build-migration-audit.mjs` and
  `npm run db:audit` re-run to regenerate the committed query; the unit suite
  fails until both are done. The audit is what answers whether the *hosted*
  project has the migration - see the note under "Production Monitoring"
- `create table`, `create index`, and `create function` statements are written
  idempotently (`if not exists` / `or replace`). `create policy` is not, so a
  half-applied migration cannot simply be replayed — check `db:status` first. The
  baseline below is the one exception: it drops each policy first, because it is
  written to meet a database that already has those tables
- Applying requires `supabase login` and `supabase link`, which need a personal
  access token and the database password. Those are interactive and belong to
  the operator, not to CI or an agent

### Building a database from nothing

`supabase start` on a clean machine builds the whole schema. Two files exist only
to make that true, and both are easy to undo by accident:

- `20260223000000_init_baseline_schema.sql` creates `profiles`, `vehicles`,
  `tracks` and `sessions`. Those four were originally made by hand in the
  dashboard, so nothing created them and the second migration died on
  `relation "public.profiles" does not exist`. It is dated *before* the rest of
  the history on purpose, and holds the tables' **original** shape - later
  migrations still add the columns they always added
- `20260719001100_grant_data_api_access.sql` is the only place the Data API roles
  get table access. Nothing in the repo granted any before it. The hosted project
  never noticed because it predates the change and still carries Supabase's legacy
  auto-expose defaults; a project created today does not (see
  `auto_expose_new_tables` in `supabase/config.toml`), so it applied every
  migration cleanly and then answered every PostgREST request with
  `permission denied for table ...`

`20260816001200_add_profile_on_auth_user_created.sql` is **not** one of those two.
It is the only thing that puts a row in `profiles` for a rider who did not arrive
through the beta invite route, so it is a production fix for existing deployments
just as much as it is part of a clean build - an environment that skips it keeps
the bug on every other signup path, whatever its schema was built from.

**`profiles` is written by a trigger on `auth.users`, and it has to be.** A rider
signing up through the ordinary form once `BETA_INVITE_ONLY` is off goes from the
browser straight to GoTrue (`components/auth/auth-form.tsx` calls
`supabase.auth.signUp`), and an OAuth signup is GoTrue talking to the provider.
Neither reaches a route handler before the account exists, so **there is no
application choke point to put this in** - the nearest thing, `getRealUser()` in
`lib/auth.ts`, is on the read path of every authenticated page and would need the
admin client anyway, since `authenticated` deliberately holds no INSERT here.

Reading a missing row degrades correctly - `resolveUserAccess(null)` is the free
tier - which is why this stayed invisible. Paying does not:
`app/api/stripe/checkout/route.ts` attaches the Stripe customer by updating
`profiles` and correctly refuses to charge when the update matches nothing, so a
rider with no row gets `Unable to link your billing account` **forever**. That was
reproduced end to end against a local stack and is written up in the migration.

`tests/unit/migrations-bootstrap.test.ts` fails if that trigger goes missing, ends
up disabled, or stops inserting into `profiles`. Like everything else in that file
it reads SQL as text: it cannot prove the insert *succeeds*, which depends on
`security definer`, the owner's privileges and the pinned empty `search_path`.
Only signing up against a real database shows that.
`tests/e2e/signup-creates-profile.spec.ts` is that walk, and it skips unless
`BETA_INVITE_ONLY` is `false`, because with invite-only on the form posts to the
route that always wrote the row - see `TESTING.md` for what it needs.

**`auth.identities` carries a trigger too, and it is a security gate.** GoTrue
links a provider sign-in into the account that holds its email, and counts the
provider's email as verified whenever "Confirm email" is off
(`enable_confirmations = false` here) - so an unverified Google address was given
a session on another rider's account, reproduced end to end against a stub
issuer. `20261004002700` refuses every external identity whose `email_verified`
is not true, a new account's first one included - otherwise an unverified
sign-in could create the account a real owner's verified sign-in later links
into. A verified sign-in and email signup pass. `tests/db/unverified-identity-link.spec.ts` replays GoTrue's
insert as `supabase_auth_admin`, and the hosted setting is in
`docs/beta-runbook.md` beside the hand-apply block.

**The baseline says the opposite, and it is right about the day it was written.**
`20260223000000_init_baseline_schema.sql` states that nothing creates a `profiles`
row automatically and that the beta signup route is the one writer. That was true
until `20260816001200`, and it is the reason the table has select and update
policies for a user's own row but no insert policy. It is left standing rather than
corrected in place because **an applied migration is never edited** - not even its
comments. The rule is worth more as a bright line than as a judgement call, and the
argument for a comment-only exception rests on what the CLI does with a changed
file rather than on anything this repository can verify. This paragraph is the
correction; read the two files together. The policies themselves need no change,
because the trigger inserts as the function's owner rather than as the rider, so
there is still no insert policy to add.

**Grants are per role and per table, and that is a security boundary rather than
tidiness.** `anon` gets no table access at all, `service_role` gets everything
schema-wide, and `authenticated` is granted table by table. `profiles` is
`select` only for it.

The reason is worth knowing before widening any of it. **RLS chooses which ROW a
policy admits and cannot restrict which COLUMN is written.** So while
`profiles: update own` correctly limits a user to their own row, any `update`
privilege on that table would also let them set `tier`, `beta_access_expires_at`
and the Stripe identifiers on it, which `lib/access.ts` reads as paid access. That
was reproduced against a rebuilt database, twice, as a plain `PATCH` carrying only
the public key and the user's own session. Withholding the privilege is the fix;
no policy can be written that would do it. The one legitimate user-context write
to that table, the Stripe customer link, runs through the admin client inside an
already authenticated route (`app/api/stripe/checkout/route.ts`).

The default privileges match: future tables reach `service_role` and never the
Data API roles, so a migration adding a table grants what that table needs. The
file also has to `revoke` before it grants, because the CLI itself hands `anon`
and `authenticated` truncate, references and trigger, and RLS does not apply to
truncate. `tests/unit/migrations-bootstrap.test.ts` fails on any migration that
grants those roles more than `select` on `profiles` - on the table or on one
column - or that reaches them with a schema-wide or default table grant, and
reads `public` as a target alongside them in every spelling, since both are
members of it.

**A migration in this repository is not evidence the hosted project has it.** On
2026-08-25 `has_table_privilege('authenticated', 'public.profiles', 'update')`
was still `true` there: the project was never built through the CLI, so
`db push` has no history to compare against and `20260719001100` has to be
applied in the SQL editor by hand. "Apply the Data API grants by hand" in
`docs/beta-runbook.md` is that block with its verification and rollback, and
`tests/unit/hosted-grants-runbook.test.ts` fails if it and the migration ever
differ. Whether a database is actually closed is answered only by a request at
it: `tests/e2e/profile-entitlement-columns.spec.ts` sends the escalation as a
rider and as nobody, needs no dev server, and is what to run against a stack
after applying either path

What it builds is the schema and the storage buckets, and the buckets come from a
different file. The CLI provisions buckets from `[storage.buckets.*]` in
`supabase/config.toml`, not from migrations: `supabase start` and `db reset` seed
`vehicle-photos` and `session-photos` locally, and a linked hosted project gets
them from `npx supabase seed buckets --linked` ("Local Run" in `docs/local-development.md`), which
`db push` does not do; the hand-apply blocks in `docs/beta-runbook.md` create
`session-photos` in SQL instead. The policies on `storage.objects` that scope
writes to the rider's own folder are SQL, so they are migrations
(`20260824001300`, `20260926002000`). A declared bucket is held to those policies
even when only the mobile app writes it. Before that block existed every `[storage.buckets.*]` line was
the CLI's commented-out template, a fresh database applied every migration cleanly,
and `components/garage/vehicle-form.tsx` answered the first photo with
`Photo upload failed: Bucket not found` - invisible on any stack somebody had
already fixed by hand. `tests/unit/storage-bucket-provisioning.test.ts` fails if
the app uploads to a bucket that file does not declare as public, or that no
migration gives owner-scoped select, insert *and* update policies (the form
upserts, and the storage API returns the row under RLS).
`tests/e2e/vehicle-photo-upload.spec.ts` is the walk against a rebuilt stack, and
it ends on the card actually rendering: `next/image` serves only hosts named in
`images.remotePatterns`, which `lib/supabase-storage-remote-patterns.ts` derives
from `NEXT_PUBLIC_SUPABASE_URL` when `next.config.ts` loads - so a local stack
renders its own photos and the rule is not a second copy of the URL. It once named
`*.supabase.co` alone, and the garage threw on every local photo while the spec
passed, because nothing looked at the card. Seeded tracks are a migration too -
see "A circuit is an identity" under "What a Rider Told You".

**Retained AI question text (`ai_request_text`, 20260924001700) is the one table a
rider may DELETE and must never UPDATE or INSERT.** Deleting is the rider's control
over their own text; UPDATE would let them move `retain_until` past the 90 days the
notice promises, and INSERT would plant text a verdict appears to answer. It is kept
apart from `ai_requests` because that table is the rate limit, and a rider must never
delete those rows. `tests/unit/migrations-bootstrap.test.ts` fails any grant wider than
`select, delete` to `authenticated`, and any at all to `anon` or `public`. The migration
revokes before it grants because hosted still carries the legacy `grant all` defaults.
Because RLS trusts the text row's own `user_id`, ownership is enforced by a composite
foreign key to `ai_requests(request_id, user_id)`, and `retain_until` is capped at
`created_at + 90 days` by a CHECK - the purge and the health check both trust it - and
a before-insert trigger pins `created_at` to the insert time so no writer can date a
row ahead. The 140-character `ai_requests.prompt_redacted_preview` follows the same
keep rule as the text: the routes write it only for a keeping rider, the migration
nulled every existing one, and the purge nulls any preview whose rider's text may
not be kept, with consent judged as of when the preview was written, so one from
before the notice or the latest opt-in goes too. That migration's purge comment
says the routes write a preview for everyone, and `20260925001800` says nothing
writes the text table yet; both were true until capture shipped and neither file
is edited.
The rule is written in SQL once, as
the `ai_requests_unretainable_previews` view, which that clear, the purge and
`/api/health` all read.
A daily `pg_cron` job purges it, and `/api/health`'s `ai_text_retention` check is what
proves the job runs. The four `profiles.ai_question_retention_*` columns decide
whether text may be kept at all, and the rule is written once, in that migration's
header. Since `20260925001800` (owner, 2026-09-25) `requires_opt_in` is
true for every rider and by default, so nothing is kept until a rider opts in;
no jurisdiction is detected, and nothing in the app writes that column. The app
does not read it either: `resolveQuestionRetention` counts a rider as keeping
only once `opted_in_at` is set, and the notice's "Not now" stamps
`opted_out_at`, so the screens stay opt-in on a database the migration has not
reached. Only `lib/actions/ai-question-retention.ts` writes them (service client),
and `planRetentionChange` (`lib/ai-question-retention.ts`) decides what: turning
keeping back on RE-STAMPS `opted_in_at` so text written while off stays
unretainable, and choosing it while already keeping writes NOTHING, since a
re-stamp would make everything kept so far unretainable. Every word a rider reads
about it - privacy page, the line under both question boxes, the Settings card,
the one-time notice - comes from `lib/ai-question-retention-copy.ts`.

**Capture is one decision, made by the route and required by the type.**
`reservePendingSlot` and `recordRefusedRequest` (`lib/rag/ai-request-log.ts`) write
the text row beside the audit row they insert, at reservation so a refusal, limit
or crash keeps its text too, and a released reservation takes it with it through
the cascade; `updateRequestLog`, the third write, never touches text. Both take a
required `retainRiderText` with no default (`RiderTextCapture`), so a third AI route
cannot compile without answering it, and both routes answer it with
`resolveQuestionRetention(profile).keeping` - opt-in in the code, never reading
`requires_opt_in`. False writes no text row and a NULL preview, which is what makes
"This question is not kept after it is answered" true. The database asks again at
insert (`20260926001900`): a text row is dropped and a preview nulled unless the
rider is keeping at that moment, by the same opt-in rule, and the profile row is
read `for share`, so a rider turning keeping off while a question is in flight
either wins and nothing is written or waits and then deletes what was. A failed
text insert is reported and the rider still gets their answer. What is masked is
`redactForStorage` (`lib/ai-observability.ts`), the one helper for BOTH copies,
because the notice promises the masked kinds in one sentence: change what it masks
and bump `REDACTION_VERSION` and check that sentence in the same change.
`ai_requests.app_commit` is `VERCEL_GIT_COMMIT_SHA` at write time, null locally.
What may leave the database for Redline is decided by one view, `ai_replay_export`
(20260927002000) - kept now, written after the latest opt-in, not past
`retain_until`, no user, session or vehicle id - and `npm run ai:export-replay` reads
nothing else; `docs/ai-replay-export.md` is the JSONL contract both sides test against.
Each export is a whole snapshot, never a date window, and Redline replaces its copy
with the newest file: that is how a rider's delete reaches Redline, so a window must
not come back.

Functions are deliberately *not* granted schema-wide. RLS contains a table; it does
not contain a `security definer` function, which runs as its owner and bypasses
every policy, so for a function the grant *is* the access control. Execute belongs
to the migration that creates the function, which is the only place its caller is
known - see the `revoke` / `grant execute` pairs on `create_beta_invite` and
`consume_beta_rate_limit`. When that migration is already applied on the remote,
editing it would change the file and not the database, so the pair goes in a new
migration instead: `20260719001100` carries the pairs for `save_session_outcome`
and `record_race_engineer_memory_feedback` for that reason. The routines default
privilege therefore revokes execute from `public` rather than granting it.

That revoke is a declaration of intent, not a guarantee, and the difference was
measured rather than reasoned about. It is recorded correctly in `pg_default_acl`,
but on a rebuilt local stack a function created afterwards still comes out with a
null `proacl`, which is Postgres's built-in `execute` to `public`. The same
statement against `tables` does take effect, so the mechanism works and this one
case does not. **A new function is world-executable until its own migration revokes
it.**

So the migration has to say so itself, and
`tests/unit/migrations-bootstrap.test.ts` now fails a `security definer` function
whose migration does not. Either statement satisfies it, because the requirement is
that the decision is written down and not that every function is locked:

```sql
revoke all on function public.f(...) from public, anon, authenticated;  -- locked
grant execute on function public.f(...) to public;                      -- open, on purpose
```

Both name `public`, which is the only role that settles it: `anon` and
`authenticated` are *members* of `public`, so revoking from those two by name while
public still holds execute reads like a lockdown and closes nothing. That near-miss
has its own fixture. `security invoker` functions are out of scope - they run as
their caller, so RLS still applies and execute is not the access control.

The check requires the decision in the function's **own** migration, because the
gap between two migrations is a window in which a `security definer` function is
world-executable. **A deferred decision is flagged whatever the function's
security**, because it is not only a window: a database that takes the creating
migration and never the later one keeps the function at execute-to-public, and
nothing in the first file says so. That is how the hosted project lost the
`save_session_outcome` grant - `20260719001100` revokes it and
`record_race_engineer_memory_feedback` in a later migration than the ones
creating them, on the belief that `20260716000800` was already applied there.
Those two are applied, so they are pinned as the only exceptions; a third fails.

`tests/unit/migrations-bootstrap.test.ts` reads the SQL as text and fails if a
migration alters or references a table nothing earlier creates, if those grants go
missing, if a `security definer` function arrives without that decision, if a
migration re-grants execute schema-wide over a per-function `revoke`, or if the
migrations end with nothing writing `profiles` on signup (above). It cannot
tell you a migration *runs* - only `supabase start` from a destroyed local stack
proves that, and only then exercising the app against it proves PostgREST can see
the result. It reads the decision rather than its effect, so once `public` is
named, a revoke listing the wrong roles beside it still passes.

The wrong SQL it is meant to catch lives in `tests/fixtures/migration-guard/`,
outside `supabase/migrations/` so no Supabase command applies it. Each check was
watched failing against those files before it was written, because a guard that has
only ever been run against a repository that gets it right proves nothing.

The baseline is dated before migrations the remote has already recorded, so
`db push` will report it as out of order and refuse without `--include-all`.

Do not reach for `migration repair` on reflex. The baseline is not a pure no-op
against a database that already has these tables: `create table if not exists`
skips, but each policy is preceded by `drop policy if exists`, so running it
replaces the live policies with the ones in this file. Those were reconstructed
from `types/supabase.ts` and the application's queries, not read off the hosted
project, so they may not match what is actually there. Compare the live policy
definitions against this file first (`pg_policies` in the SQL editor, or
`npx supabase db diff --linked`). Only once they agree, record it as applied
rather than running it:
`supabase migration repair --status applied 20260223000000`. If they disagree,
that difference is the real finding and needs deciding before anything is
recorded.

One such difference is known: the hosted project names the four `sessions`
policies "Users can select own sessions" and so on, where the baseline says
"sessions: select own". `20260928002300` renames any it finds to the baseline's
names before altering them, so after it the hosted names match. A migration that
alters a hosted policy by name has to check its live name first - a name only
the baseline spells makes `alter policy` fail on the hosted paste.

