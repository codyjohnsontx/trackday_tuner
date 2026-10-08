# Founding Beta Runbook

## Launch Checklist

1. A deployment standing up its own database applies every file in
   `supabase/migrations/` in Supabase CLI order, not just the beta ones: the
   baseline `20260223000000` first, then everything between it and the tail,
   including `20260224000100`, `20260228000200` and `20260422000400`. `supabase
   start` and `db push` do this for you; the point is that no file in that range
   is optional. See "Building a database from nothing" in CLAUDE.md.
   The beta-specific tail of that same order is `20260716000800` (session
   outcomes), `20260717000900` (session laps), `20260718001000` (beta
   foundation), then `20260719001100` (the Data API grants), then
   `20260816001200`, which is not beta-specific but installs the trigger that
   gives every signup path a `profiles` row - without it a rider who did not
   arrive through the invite route can never subscribe - then
   `20260824001300`, the owner-scoped write policies on the `vehicle-photos`
   bucket, then `20260901001400`, the lap-count guard on `replace_session_laps`,
   and finally `20260903001500`, which replaces that count with a comparison of
   the laps themselves. On a deployment whose database already predates this
   work, those eight are what is left to apply; run the check below before
   `20260816001200` and the audit below after it. On a deployment whose database
   has no migration history at all, `20260719001100` is applied in the SQL editor
   by hand - see "Apply the Data API grants by hand" below, and do that first:
   until it is done any rider can set their own tier to `pro`.
   Migrations build the schema and the storage policies, not the storage buckets:
   the CLI provisions buckets from `[storage.buckets.*]` in `supabase/config.toml`,
   so on a deployment standing up its own project, `npx supabase seed buckets
   --linked` after `supabase link` is what creates `vehicle-photos` and
   `session-photos`. Without it, adding a vehicle with a photo fails with "Photo
   upload failed: Bucket not found". See "Local Run" in README.md.
   `20260901001400` and `20260903001500` are the migrations in that list carrying
   a **deploy-ordering requirement**: each changes the signature of
   `replace_session_laps`, so apply them *before* the release that calls it goes
   live. Migrations here are applied by hand while Vercel deploys on merge, so on
   an existing deployment that means applying them before merging the pull
   request that ships the matching caller. Either order leaves a window and both
   were walked in a browser: the mismatched call gets `PGRST202` from PostgREST,
   nothing is saved and nothing stored is lost. The rider no longer reads that
   `PGRST202`: `replaceSessionLaps` (`lib/actions/sessions.ts`) and
   `lib/sessions/create.ts` pass through only their functions' own domain
   rejections and answer everything else with a sentence saying the save did not
   happen, sending the real error to `reportError`. So the window is quiet on
   screen, and what names it is the deployment's own `/api/health` - its
   `schema_contract` check resolves `replace_session_laps` by parameter name and
   fails on exactly this drift (see `docs/monitoring.md`).
   Saving laps *and* logging a session are both down for that window -
   `create_session_with_laps` calls the function even for a session with no
   laps - while reading is unaffected. Each migration's own header carries the detail.
   `20260924001700` (retained AI question text and its 90-day purge) also goes
   in by hand on a project with no migration history, and also before the
   release that ships it - see "Apply the AI question-text table by hand" below.
   `20260926002000` (the session photo column, the `session-photos` bucket and
   its policies) goes in by hand the same way, bucket included, and is applied
   and verified before the release that ships it deploys: deleting a session or
   a bike on the website reads `sessions.photo_url`, so without the column
   every session delete fails, the bike delete confirmation cannot load, and
   no bike can be deleted - see "Apply session photos by hand" below.
   `20260926002100` (`delete_vehicle_if_sessions_unchanged`) follows it by hand
   in the same window: deleting a bike calls that function, so without it every
   bike delete fails with `PGRST202` and `/api/health`'s `schema_contract`
   check names it - see "Guard bike deletes by hand" below.
   `20261010000100` and `20261010000200` (the service book) go in by hand
   together, in one paste. Nothing reads them until the service book screens
   ship, so they carry no deploy-ordering requirement - see "Apply the service
   book tables by hand" below.
2. Set `BETA_INVITE_ONLY=true`, a long random `BETA_INVITE_SECRET`, and a distinct
   `BETA_FORM_RATE_LIMIT_SECRET` in the deployment environment.
3. Deploy and verify the public home page, waitlist, invitation signup, session
   capture, comparison, and outcome flows.
4. Recruit twelve motorcycle track-day riders who expect at least two track dates
   in the next 90 days.

Never change `BETA_INVITE_SECRET` while active invitations exist; invitation hashes
cannot be recovered after rotation.

### Before applying the profiles trigger: confirm the hosted table takes its insert

`20260816001200` puts a `profiles` insert on the path of **every** signup,
including the invite route that is the only live path today, and the insert is
deliberately not wrapped in an exception handler - swallowing a failure would
recreate the exact bug it fixes. So a hosted `public.profiles` that will not
accept it fails all signups rather than only the new path.

That is worth checking rather than assuming, because these four tables were
originally made by hand in the dashboard and `npm run db:status` compares
recorded migration versions, not schema - it cannot see a column added or
tightened in the dashboard afterwards (see CLAUDE.md). The trigger supplies `id`
and `tier` and nothing else, so two things can stop its insert, and each has a
query.

First, a column the insert never supplies that the table demands:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
and table_name = 'profiles'
and column_name not in ('id', 'tier')
and is_nullable = 'NO'
and column_default is null
and is_identity = 'NO'
and is_generated = 'NEVER'
order by ordinal_position;
```

The expected result is zero rows. Any row it returns is a column the trigger's
insert never sets and the table will not default, so applying the migration would
make **every** signup fail - including the invite route, which is the only live
path today. That is the whole reason this check exists.

The last two conditions are not padding, and each was watched mattering rather
than reasoned about. An identity column reports `column_default` as null even
though the server supplies its value from an implicit sequence, and a generated
column declared `not null` reports null there too because it is computed rather
than defaulted. An unqualified generated column is already excluded, since
`information_schema` reports it nullable. Drop either condition and a table
carrying such a column comes back non-empty, while with both in place it still
takes the trigger's `insert into public.profiles (id, tier)` exactly as written.
A check whose documented answer is "zero rows, otherwise stop and escalate" has
to be right in both directions: a false row here halts a deployment that would
have been fine.

Second, the check constraint on `tier` no longer admitting `'free'`:

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.profiles'::regclass and contype = 'c';
```

Expect a check on `tier` that admits `'free'` - the baseline writes it as
`check (tier in ('free', 'pro'))`. One narrowed by hand to exclude `'free'`
rejects every row the trigger writes.

Those two queries are the narrow, decisive version of the question for this one
insert. `npx supabase db diff --linked` sits beside them as the broader drift
check: it prints the SQL that would reconcile the live schema with the migration
files, so read what it says about `public.profiles`. Empty output means no
difference *the diff engine models* was found, not proof the two are identical.

If either query does not come back as described, **STOP and escalate rather than
improvising** - reshaping a live table is a product-owner decision, and this
runbook prescribes none.

### Audit accounts that predate the profiles trigger

`20260816001200` installs an `after insert` trigger on `auth.users`, so it only
fires on future signups. Applying it fixes every signup from that moment on and
changes nothing about accounts that already exist: an account created before it
was applied that has no `profiles` row still has none, and still cannot
subscribe. Settle whether any such account exists with:

```sql
select u.id, u.email, u.created_at
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
order by u.created_at;
```

The expected result is zero rows, because every rider so far arrived through the
beta invite route, which creates the profile itself. **That expectation has not
been verified against the hosted project** - this repository carries no linked
project ref or hosted credentials, and `supabase login` / `supabase link` are the
operator's interactive steps rather than an agent's (see CLAUDE.md). Treat it as
an open check, not a confirmed "none".

Two paths leave an `auth.users` row with no profile, so the query is worth
running rather than assumed: an account created by hand in the Supabase
dashboard, and the cleanup path in `app/api/beta/signup/route.ts`, which logs a
failed `deleteUser` and leaves the auth user behind.

If the query returns rows, **escalate rather than improvising**. What to do about
an existing account with no profile is a product-owner decision, and this runbook
deliberately prescribes no backfill.

### Apply the Data API grants by hand on a project with no migration history

`20260719001100` is what stops a rider granting themselves paid access. It
replaces the platform's legacy `grant all` to the Data API roles with a grant
per role and per table, and leaves `authenticated` with SELECT only on
`profiles`. Postgres RLS chooses which ROW a policy admits and cannot restrict
which COLUMN is written, so with UPDATE on that table a rider's own session can
set `tier`, `beta_access_expires_at` and the Stripe identifiers on their own
row - `lib/access.ts` reads the first two as Pro, and the checkout and portal
routes trust the third. On 2026-08-25 the hosted project still answered that
request with 200 and the elevated values: its schema was never applied through
the CLI, there is no `supabase_migrations.schema_migrations` there for
`db push` to compare against, so the grants have to be applied in the SQL editor
by hand. **Nothing in this repository can do that step; the owner runs it and
verifies it.** A database that does apply migrations through the CLI gets the
same statements from the migration itself (`npm run db:push`, with
`--include-all` because the baseline is dated before files the remote may
already record) and must not be given this block.

Whether a project needs it is one query in the SQL editor:

```sql
select
  has_table_privilege('authenticated', 'public.profiles', 'update')
  or has_any_column_privilege('authenticated', 'public.profiles', 'update')
    as rider_can_update_profiles;
```

`true` means the escalation is open. `false` means this rider can no longer
`update` `profiles` by any grant, table-level or column-level, so the paid-tier
escalation is closed - which is what this section exists to close. It checks
`update` because that is the escalation (the rider rewrites `tier` on their own
existing row); a stray `insert` or `delete` grant is a different shape and is
not what this line tests - the full-surface query under "Verify" below is what
would surface one. It does not by itself prove the whole grants
migration ran: a project could have had `profiles` write revoked by hand while
other parts of `20260719001100` are still missing. The full-surface query under
"Verify" below confirms two of those, the `anon` revokes and the `authenticated`
table grants, and nothing more: it reads `role_table_grants` for those two roles
only. The remaining pieces of the migration - the `service_role` grants, the
sequence privileges and the default privileges - are what make the Data API
work rather than part of this escalation, so this section does not verify
them (the per-column query's `server_update` column is the one glimpse of
`service_role`, and only on `profiles`); on a CLI-managed database they come
from applying the migration itself. The
`has_any_column_privilege` half is not redundant: `has_table_privilege(...,
'update')` returns false for an `update` granted only on a column, so a stray
`grant update (tier) on profiles` would read as closed while leaving the paid
tier writable. The two together are true if the rider can write any column by
any grant. A table-level grant to `public` also shows here, because
`authenticated` inherits it - so this catches a `public`-inherited grant even
though the block, mirroring the migration, revokes only from `anon` and
`authenticated` (see the note under "Verify").

**1. Confirm every table the block names exists.** The block runs as one
transaction, so a missing table fails all of it, and a table this app reads
being absent is its own finding - stop and escalate rather than editing a line
out.

```sql
-- hosted-grants-tables: the tables 20260719001100 grants to authenticated
select count(*) as granted_tables
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles', 'vehicles', 'tracks', 'sessions', 'session_environment',
    'session_changes', 'vehicle_baselines', 'sag_entries', 'session_laps',
    'telemetry_summaries', 'session_feedback', 'race_engineer_memory',
    'ai_recommendations', 'beta_feedback', 'product_events'
  );
```

Expect `15`.

**2. Run this block, whole, in the SQL editor.** It is
`supabase/migrations/20260719001100_grant_data_api_access.sql` with its
comments removed, in the order that file runs, inside a transaction so an error
anywhere applies nothing. `tests/unit/hosted-grants-runbook.test.ts` fails if
the two ever differ. `alter default privileges` binds to the role running it,
which in the SQL editor is `postgres` - the same role the CLI applies
migrations as, so the defaults land where a table created from the dashboard
or a later hand-applied migration will pick them up.

```sql
-- hosted-grants: mirror of supabase/migrations/20260719001100_grant_data_api_access.sql
begin;
grant usage on schema public to anon, authenticated, service_role;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.vehicles to authenticated;
grant select, insert, update, delete on public.tracks to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, update, delete on public.session_environment to authenticated;
grant select, insert, update, delete on public.session_changes to authenticated;
grant select, insert, update, delete on public.vehicle_baselines to authenticated;
grant select, insert, update, delete on public.sag_entries to authenticated;
grant select, insert, update, delete on public.session_laps to authenticated;
grant select, insert, update, delete on public.telemetry_summaries to authenticated;
grant select, insert, update, delete on public.session_feedback to authenticated;
grant select, insert, update on public.race_engineer_memory to authenticated;
grant select, update on public.ai_recommendations to authenticated;
grant select, insert, update on public.beta_feedback to authenticated;
grant select, insert on public.product_events to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select, update on sequences to service_role;
alter default privileges in schema public
  revoke execute on routines from public;
revoke execute on function public.save_session_outcome(
  uuid, uuid, uuid, uuid, text, smallint, text[], text, smallint
) from public, anon, authenticated;
grant execute on function public.save_session_outcome(
  uuid, uuid, uuid, uuid, text, smallint, text[], text, smallint
) to authenticated;
revoke execute on function public.record_race_engineer_memory_feedback(
  uuid, uuid, uuid, uuid, text, date, text, text[], text
) from public, anon, authenticated;
grant execute on function public.record_race_engineer_memory_feedback(
  uuid, uuid, uuid, uuid, text, date, text, text[], text
) to authenticated;
commit;
```

What it deliberately leaves alone: `service_role` keeps whatever the platform
already gave it (it is the trusted server identity and bypasses RLS either
way), the legacy default privilege on *functions* for the Data API roles is
not withdrawn (a new function's own migration decides its execute, exactly as
CLAUDE.md requires), and no function other than the two named changes hands.
A `function ... does not exist` error on one of those two means the hosted
project is missing an RPC the app calls, which is a finding to escalate, not a
line to delete.

**3. Verify.** The first query is the one that was `true` on 2026-08-25:

```sql
select
  has_table_privilege('authenticated', 'public.profiles', 'update') as rider_can_update_profiles,
  has_table_privilege('authenticated', 'public.profiles', 'select') as rider_can_read_profiles,
  has_table_privilege('anon', 'public.profiles', 'select') as nobody_can_read_profiles,
  has_table_privilege('anon', 'public.sessions', 'truncate') as nobody_can_truncate_sessions;
```

Expect `false, true, false, false`. Then every column, because a column-level
grant would pass the table check and reopen one column:

```sql
select
  column_name,
  has_column_privilege('authenticated', 'public.profiles', column_name, 'update') as rider_update,
  has_column_privilege('service_role', 'public.profiles', column_name, 'update') as server_update
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;
```

Expect `rider_update` to be `false` and `server_update` to be `true` on every
row - `tier`, `beta_cohort`, `beta_access_started_at`, `beta_access_expires_at`,
`stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id` and
`stripe_current_period_end` included. Then the whole surface:

```sql
select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by grantee, table_name
order by grantee, table_name;
```

Expect no `anon` row at all, and exactly these fifteen for `authenticated`.

If `rider_can_update_profiles` still reads `true` after the block, the residual
grant is not one the block reaches. The block mirrors the migration, which
revokes from `anon` and `authenticated` only; a privilege granted to `public`
survives it, and `authenticated` inherits it. Supabase's legacy defaults grant
to `anon`, `authenticated` and `service_role`, not `public`, so this was not the
hosted state on 2026-08-25 and the block closed it in full - but a project that
does carry a `public` grant needs `revoke all on public.profiles from public`
(or `... on all tables in schema public from public`) as well, which is outside
this block precisely because no migration issues it. The e2e proof below is the
decisive check either way: it returns 200 with the elevated row for any residual
write grant, whatever role holds it.

The fifteen `authenticated` rows:

| table                  | privileges                     |
| ---------------------- | ------------------------------ |
| `ai_recommendations`   | SELECT, UPDATE                 |
| `beta_feedback`        | INSERT, SELECT, UPDATE         |
| `product_events`       | INSERT, SELECT                 |
| `profiles`             | SELECT                         |
| `race_engineer_memory` | INSERT, SELECT, UPDATE         |
| `sag_entries`          | DELETE, INSERT, SELECT, UPDATE |
| `session_changes`      | DELETE, INSERT, SELECT, UPDATE |
| `session_environment`  | DELETE, INSERT, SELECT, UPDATE |
| `session_feedback`     | DELETE, INSERT, SELECT, UPDATE |
| `session_laps`         | DELETE, INSERT, SELECT, UPDATE |
| `sessions`             | DELETE, INSERT, SELECT, UPDATE |
| `telemetry_summaries`  | DELETE, INSERT, SELECT, UPDATE |
| `tracks`               | DELETE, INSERT, SELECT, UPDATE |
| `vehicle_baselines`    | DELETE, INSERT, SELECT, UPDATE |
| `vehicles`             | DELETE, INSERT, SELECT, UPDATE |

The end-to-end proof is the request the escalation was reported through, and
`tests/e2e/profile-entitlement-columns.spec.ts` sends it. Pointed at the hosted
project it creates one throwaway auth user through the admin API, tries every
entitlement and billing column as that rider and as nobody, checks the rider's
own reads and garage writes and the service-role customer link still work, and
deletes the user again:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
PW_SKIP_WEBSERVER=1 \
npx playwright test tests/e2e/profile-entitlement-columns.spec.ts --project=desktop-chrome
```

Against a project still in the legacy state it fails 13 of 15, with the first
failure printing `status: 200` and the row carrying `tier: "pro"`; against one
the block has been applied to it passes 15 of 15.

**4. Rollback, only to recover an app the block broke.** This reopens the
escalation, so it is a way back to a working app while the cause is found, not
a state to stay in. It restores the four data privileges to `authenticated`
only, on every table and sequence. `anon` is left as the block set it: the app
never reads or writes any table as anon, since every unauthenticated write goes
through the service client, so restoring it would reopen surface without
recovering anything. Truncate, references and trigger are not restored because
nothing uses them, and the two function grants are left as the block set them
because `authenticated` still holds execute on both.

```sql
-- hosted-grants-rollback: reopens the escalation on profiles; recover the app, then come back
begin;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select, update on all sequences in schema public to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select, update on sequences to authenticated;
commit;
```

### Apply the AI question-text table by hand on a project with no migration history

`20260924001700` creates `ai_request_text`, where the text of a rider's Race
Engineer question (and a Morning Plan's track name, conditions and date) is kept
for 90 days so it can be replayed through new versions of the guards. It also
schedules the daily `pg_cron` job that deletes that text on time, adds the
four `profiles` columns that record whether a rider's text may be kept, and adds
`ai_requests.app_commit`. The routes write the table only for a rider who has
turned question history on (see "Confirm question capture after the deploy"
below). The hosted project has no CLI history,
so this block is how it gets there, and the owner runs it.

Apply it **before** merging the pull request that ships it. That release adds
the `ai_text_retention` check to `/api/health`, which reads the table and
answers `503` with `SupabaseError:PGRST205` on a database without it.

**Applying this block PERMANENTLY DELETES every existing
`ai_requests.prompt_redacted_preview`.** Nothing of a rider's is kept until they
have seen the retention notice, the preview is question text too, and when the
block runs no rider has seen the notice yet - so every preview there is gets
nulled, recent ones included. There is no undo: the rollback below does not
bring them back. The owner decided this on 2026-09-24, accepting the loss of
recent operational preview data (`npm run ai:requests` prints `-` for them). The
`ai_requests` rows, their fingerprints and verdicts are kept.

After that, the daily job keeps both rules: it nulls every preview older than 90
days, and every preview of a rider whose text may not be kept - one who has not
seen the notice, has opted out, or signed up where keeping starts off and has
not opted in. Consent is judged as of when the preview was written, so a preview
from before the rider saw the notice, or before their latest opt-in, goes too.
The `ai_requests_unretainable_previews` view is the one place that
rule is written, and the block's own clear, the job and `/api/health` all read
it. The routes write a preview only for a rider who has turned question history
on, so the job is the backstop rather than the gate: a preview that becomes
unretainable after it was written - the rider turned keeping off and the
delete missed one - lives until the next 04:17 UTC run, under a day, and
`/api/health` fails `ai_text_retention` if one survives 36 hours. Before the
capture change shipped every request wrote one, and this job was what kept the
rule.

The block also installs a trigger that stamps every new `ai_request_text` row
with the time it is inserted and caps its `retain_until` at 90 days after that,
whatever the writer passes, so no writer can keep text longer by dating a row
ahead.

**1. Confirm the project can take it.**

```sql
select
  to_regclass('public.ai_requests') is not null as has_ai_requests,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'ai_requests'
            and column_name = 'prompt_redacted_preview') as has_preview,
  exists (select 1 from pg_available_extensions where name = 'pg_cron')
    as pg_cron_available;
```

Expect `true` three times. A `false` in either of the first two is a missing
earlier migration - run the audit (`scripts/sql/audit-migrations-against-database.sql`)
and stop. `pg_cron_available` false means the purge cannot live in the database
on this project, and the owner's fallback is a daily Vercel Cron calling the same
function; that is not built yet, so stop and say so rather than applying the
table without its purge.

**2. Run this block, whole, in the SQL editor.** It is
`supabase/migrations/20260924001700_add_ai_request_text.sql` with its comments
removed, in the order that file runs, inside a transaction so an error anywhere
applies nothing. `tests/unit/hosted-ai-request-text-runbook.test.ts` fails if the
two ever differ. The migration revokes before it grants because this project
still carries Supabase's legacy defaults, which hand a new table to `anon` and
`authenticated` with `grant all`.

```sql
-- hosted-ai-request-text: mirror of supabase/migrations/20260924001700_add_ai_request_text.sql
begin;
create unique index if not exists ai_requests_request_id_user_id_key
  on public.ai_requests(request_id, user_id);
create table if not exists public.ai_request_text (
  request_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  route text not null check (route in ('tuning_advice', 'day_plan')),
  submitted jsonb not null check (jsonb_typeof(submitted) = 'object'),
  redaction_version smallint not null,
  created_at timestamptz not null default now(),
  retain_until timestamptz not null default now() + interval '90 days',
  constraint ai_request_text_request_owner_fkey
    foreign key (request_id, user_id)
    references public.ai_requests(request_id, user_id) on delete cascade,
  constraint ai_request_text_retain_until_within_90_days
    check (retain_until <= created_at + interval '90 days')
);
create or replace function public.ai_request_text_pin_retention()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  new.retain_until := least(new.retain_until, new.created_at + interval '90 days');
  return new;
end;
$$;
create or replace trigger ai_request_text_pin_retention
  before insert on public.ai_request_text
  for each row execute function public.ai_request_text_pin_retention();
create index if not exists ai_request_text_user_created_idx
  on public.ai_request_text(user_id, created_at desc);
create index if not exists ai_request_text_retain_until_idx
  on public.ai_request_text(retain_until);
alter table public.ai_request_text enable row level security;
create policy "ai_request_text: select own"
  on public.ai_request_text for select
  using (auth.uid() = user_id);
create policy "ai_request_text: delete own"
  on public.ai_request_text for delete
  using (auth.uid() = user_id);
revoke all on public.ai_request_text from public, anon, authenticated;
grant select, delete on public.ai_request_text to authenticated;
alter table public.ai_requests
  add column if not exists app_commit text;
alter table public.profiles
  add column if not exists ai_question_retention_notice_seen_at timestamptz,
  add column if not exists ai_question_retention_opted_out_at timestamptz,
  add column if not exists ai_question_retention_opted_in_at timestamptz,
  add column if not exists ai_question_retention_requires_opt_in boolean not null default false;
create or replace view public.ai_requests_unretainable_previews
  with (security_invoker = true)
as
select r.request_id, r.created_at
  from public.ai_requests r
 where r.prompt_redacted_preview is not null
   and not exists (
     select 1 from public.profiles p
      where p.id = r.user_id
        and p.ai_question_retention_notice_seen_at is not null
        and p.ai_question_retention_opted_out_at is null
        and (not p.ai_question_retention_requires_opt_in
             or p.ai_question_retention_opted_in_at is not null)
        and r.created_at >= greatest(p.ai_question_retention_notice_seen_at,
                                     p.ai_question_retention_opted_in_at)
   );
revoke all on public.ai_requests_unretainable_previews from public, anon, authenticated;
grant select on public.ai_requests_unretainable_previews to service_role;
update public.ai_requests r
   set prompt_redacted_preview = null
  from public.ai_requests_unretainable_previews v
 where v.request_id = r.request_id;
create or replace function public.purge_expired_ai_request_text()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.ai_request_text where retain_until < now();
  get diagnostics removed = row_count;
  update public.ai_requests
     set prompt_redacted_preview = null
   where prompt_redacted_preview is not null
     and created_at < now() - interval '90 days';
  update public.ai_requests r
     set prompt_redacted_preview = null
    from public.ai_requests_unretainable_previews v
   where v.request_id = r.request_id;
  return removed;
end;
$$;
create index if not exists ai_requests_preview_created_idx
  on public.ai_requests(created_at)
  where prompt_redacted_preview is not null;
revoke all on function public.purge_expired_ai_request_text() from public, anon, authenticated;
grant execute on function public.purge_expired_ai_request_text() to service_role;
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
select cron.schedule(
  'purge-expired-ai-request-text',
  '17 4 * * *',
  $$select public.purge_expired_ai_request_text()$$
);
commit;
```

**3. Verify.**

```sql
select jobname, schedule, command, active
from cron.job
where jobname = 'purge-expired-ai-request-text';
```

Expect one row, `17 4 * * *`, active.

```sql
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'ai_request_text'
  and grantee in ('anon', 'authenticated', 'PUBLIC')
group by grantee;
```

Expect exactly one row: `authenticated | DELETE, SELECT`. Anything else - an
`anon` row, or `INSERT` or `UPDATE` for `authenticated` - means a rider can
plant text or keep it past 90 days by moving `retain_until`; stop.

```sql
select
  has_function_privilege('anon', 'public.purge_expired_ai_request_text()', 'execute') as anon_can_purge,
  has_function_privilege('authenticated', 'public.purge_expired_ai_request_text()', 'execute') as rider_can_purge;
```

Expect `false`, `false`.

```sql
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'ai_requests_unretainable_previews'
group by grantee;

select count(*) as previews_left
from public.ai_requests
where prompt_redacted_preview is not null
  and created_at < '<when you ran the block>'::timestamptz;
```

Expect no `anon`, `authenticated` or `PUBLIC` row for the view (it lists request
ids for the health check, and `service_role` is the only reader), and
`previews_left` of `0`. The time bound is there because a request made since
the block can add one - every request did before the capture change, and a
rider who has turned question history on still does - and those are either
kept on purpose or cleared by the next 04:17 UTC run.

With no older preview left there is nothing for the first run to catch up on, so
`curl -s https://<your-app>/api/health` after the deploy should list
`{"name":"ai_text_retention","status":"ok",...,"detail":"0 overdue"}`.

**4. The day after, read whether the job ran.** `/api/health` notices a job that
never fires once a preview it should have nulled is 36 hours overdue, which on a
project serving AI requests every day is within a day or two. Reading the runs
answers sooner:

```sql
select status, return_message, start_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'purge-expired-ai-request-text')
order by start_time desc
limit 5;
```

Expect a `succeeded` row from 04:17 UTC.

**5. Rollback, only before any rider's choice or text has been stored.** It
drops the table and the four consent columns, so once the settings screen or
capture has shipped it destroys records a rider made. Until then nothing writes
any of it.

```sql
-- hosted-ai-request-text-rollback: only before the notice and controls ship
begin;
select cron.unschedule('purge-expired-ai-request-text');
drop function if exists public.purge_expired_ai_request_text();
drop view if exists public.ai_requests_unretainable_previews;
drop table if exists public.ai_request_text;
drop function if exists public.ai_request_text_pin_retention();
alter table public.profiles
  drop column if exists ai_question_retention_notice_seen_at,
  drop column if exists ai_question_retention_opted_out_at,
  drop column if exists ai_question_retention_opted_in_at,
  drop column if exists ai_question_retention_requires_opt_in;
alter table public.ai_requests drop column if exists app_commit;
drop index if exists public.ai_requests_preview_created_idx;
drop index if exists public.ai_requests_request_id_user_id_key;
commit;
```

### Make question retention opt-in for every rider, by hand

`20260925001800` carries the owner's decision of 2026-09-25: for the beta, no
rider's question text is kept until they turn it on, and no jurisdiction is
detected. It makes `profiles.ai_question_retention_requires_opt_in` true for
every existing rider and the default for new ones, so the keep rule
`20260924001700` already states - through the `ai_requests_unretainable_previews`
view - keeps nothing for a rider until `opted_in_at` is set. It clears any
preview that stops being retainable, for the same `/api/health` reason as the
block above. Apply it after that block, and before merging the pull request that
ships the notice and controls.

**1. Apply.**

```sql
-- hosted-question-retention-opt-in: mirror of supabase/migrations/20260925001800_question_retention_opt_in_for_everyone.sql
begin;
alter table public.profiles
  alter column ai_question_retention_requires_opt_in set default true;

update public.profiles
   set ai_question_retention_requires_opt_in = true
 where not ai_question_retention_requires_opt_in;

update public.ai_requests r
   set prompt_redacted_preview = null
  from public.ai_requests_unretainable_previews v
 where v.request_id = r.request_id;
commit;
```

**2. Verify.**

```sql
select
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'ai_question_retention_requires_opt_in') as default_value,
  (select count(*) from public.profiles
    where not ai_question_retention_requires_opt_in) as riders_keeping_by_default,
  (select count(*) from public.ai_requests_unretainable_previews) as previews_left;
```

Expect `true`, `0`, `0`.

**3. Rollback.** Only the default can be put back; which riders were `false`
before is not recorded, and under the earlier rule that was every rider.

```sql
-- hosted-question-retention-opt-in-rollback
alter table public.profiles
  alter column ai_question_retention_requires_opt_in set default false;
```

### Re-check the keep rule when capture writes, by hand

`20260926001900` makes the database ask again, at insert, whether the rider is
keeping: an `ai_request_text` row is dropped and an `ai_requests` preview is
written as null unless the notice has been seen, `opted_out_at` is null and
`opted_in_at` is set. It closes the window where a rider turns keeping off while
a question is in flight, which would otherwise leave a text row behind the
delete that turning it off runs. Apply it after the two blocks above, and before
merging the pull request that ships capture.

**1. Apply.**

```sql
-- hosted-capture-keep-rule: mirror of supabase/migrations/20260926001900_guard_rider_text_capture_at_write.sql
begin;
create or replace function public.enforce_rider_text_keep_rule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
     from public.profiles p
    where p.id = new.user_id
      and p.ai_question_retention_notice_seen_at is not null
      and p.ai_question_retention_opted_out_at is null
      and p.ai_question_retention_opted_in_at is not null
      for share;

  if found then
    return new;
  end if;

  if tg_table_name = 'ai_requests' then
    new.prompt_redacted_preview := null;
    return new;
  end if;

  return null;
end;
$$;

create or replace trigger ai_request_text_enforce_keep_rule
  before insert on public.ai_request_text
  for each row execute function public.enforce_rider_text_keep_rule();

create or replace trigger ai_requests_enforce_keep_rule
  before insert on public.ai_requests
  for each row
  when (new.prompt_redacted_preview is not null)
  execute function public.enforce_rider_text_keep_rule();
commit;
```

**2. Verify.**

```sql
select tgname, tgrelid::regclass as on_table, tgenabled
from pg_trigger
where tgname in ('ai_request_text_enforce_keep_rule', 'ai_requests_enforce_keep_rule')
order by tgname;
```

Expect two rows, `ai_request_text_enforce_keep_rule` on `ai_request_text` and
`ai_requests_enforce_keep_rule` on `ai_requests`, each with `tgenabled` `O`.

**3. Rollback.**

```sql
-- hosted-capture-keep-rule-rollback
begin;
drop trigger if exists ai_request_text_enforce_keep_rule on public.ai_request_text;
drop trigger if exists ai_requests_enforce_keep_rule on public.ai_requests;
drop function if exists public.enforce_rider_text_keep_rule();
commit;
```

### Confirm question capture after the deploy

The capture change writes `ai_request_text` and needs no SQL beyond the three
blocks above, which must already be applied, since the routes insert
`ai_requests.app_commit` and the text table. A route whose text insert fails still answers the rider and
reports the failure through `reportError`, so a missing table shows up in the
logs rather than as broken advice. After the deploy, sign in as a rider with Pro
access and:

1. Turn question history on under Settings > Race Engineer question history.
2. Ask Race Engineer one question containing a made-up phone number and link,
   such as `Front pushes on entry, call 555 123 4567 or see example.com`.
3. Reload Settings. The question is listed, reading `[phone]` and `[url]` where
   the number and link were, with a delete date 90 days out.
4. Delete it from the list, and confirm it is gone after a reload.

`npm run ai:requests` shows the matching `ai_requests` row with its preview, and
`select app_commit from public.ai_requests order by created_at desc limit 1` in
the SQL editor returns the deployed commit. Turn keeping off and ask again: the
new row's preview prints `-` and nothing is listed.

### Apply the replay export view by hand

`20260927002000` creates `ai_replay_export`, the one view
`npm run ai:export-replay` reads (docs/ai-replay-export.md). It is where the rule
for what may leave the database is written: text a rider is keeping now,
written after their latest opt-in and not yet past its `retain_until`, with no
`user_id`, `session_id` or `vehicle_id`. It reads `ai_request_text`, `ai_requests` and the
`profiles` retention columns and changes none of them, so applying it touches no
rider's data. Apply it after the three blocks above, and **before the first
export**: without it the script fails with `PGRST205` and writes nothing.

**1. Confirm the project can take it.** Read-only.

```sql
select
  to_regclass('public.ai_request_text') is not null as has_text_table,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'ai_requests'
            and column_name = 'app_commit') as has_app_commit,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('ai_question_retention_notice_seen_at',
                          'ai_question_retention_opted_out_at',
                          'ai_question_retention_opted_in_at')) as retention_columns,
  case
    when to_regclass('public.ai_replay_export') is null then 'absent'
    when md5(regexp_replace(pg_get_viewdef(to_regclass('public.ai_replay_export')), '\s+', ' ', 'g'))
           = 'cbfa456413cb4c7db8a026cbd2fdc7b0'
     and (select reloptions from pg_class
           where oid = to_regclass('public.ai_replay_export')) = array['security_invoker=true']
      then 'as in 20260927002000'
    else 'DIFFERENT - stop'
  end as existing_view;
```

Expect `true`, `true`, `3`, `absent`. A `false` or a count under 3 means an
earlier block is missing; apply it first. `as in 20260927002000` means this
block already ran with exactly this definition, and re-running it is harmless.

**`DIFFERENT - stop` means a view of this name is already there and is not this
one. Stop.** Existence proves nothing about what a view exports: one with the
same columns and grants but without the opt-in or `retain_until` conditions
would export text no rider agreed to share. Read it with
`select pg_get_viewdef('public.ai_replay_export'::regclass)`, find out where it
came from, and compare it with the definition below before deciding anything.
The apply block would replace it, so do not run it until that is understood.

The check compares a hash of Postgres's own rendering of the view - the text
below, whitespace folded - taken on Postgres 17 (`major_version` in
`supabase/config.toml`) with `public` on the search path, as the SQL editor has
it. A different major version can render the same view differently; that also
reads `DIFFERENT - stop`, and comparing the text settles it. If the view in
`20260927002000` changes, regenerate the hash on a local stack with
`select md5(regexp_replace(pg_get_viewdef('public.ai_replay_export'::regclass), '\s+', ' ', 'g'))`
and replace it in both queries here.

```text
 SELECT t.request_id,
    t.route,
    t.created_at,
    t.retain_until,
    t.submitted,
    t.redaction_version,
    encode(sha256(convert_to((t.user_id)::text, 'UTF8'::name)), 'hex'::text) AS rider_key,
    r.app_commit,
    r.status,
    r.refusal_reason,
    r.policy_result,
    r.policy_violations,
    r.classifier_stage,
    r.model
   FROM ((ai_request_text t
     JOIN ai_requests r ON (((r.request_id = t.request_id) AND (r.user_id = t.user_id))))
     JOIN profiles p ON ((p.id = t.user_id)))
  WHERE ((t.retain_until > now()) AND (p.ai_question_retention_notice_seen_at IS NOT NULL) AND (p.ai_question_retention_opted_out_at IS NULL) AND (p.ai_question_retention_opted_in_at IS NOT NULL) AND (t.created_at >= GREATEST(p.ai_question_retention_notice_seen_at, p.ai_question_retention_opted_in_at)));
```

**2. Apply.**

```sql
-- hosted-ai-replay-export: mirror of supabase/migrations/20260927002000_add_ai_replay_export_view.sql
begin;
create or replace view public.ai_replay_export
  with (security_invoker = true)
as
select t.request_id,
       t.route,
       t.created_at,
       t.retain_until,
       t.submitted,
       t.redaction_version,
       encode(sha256(convert_to(t.user_id::text, 'UTF8')), 'hex') as rider_key,
       r.app_commit,
       r.status,
       r.refusal_reason,
       r.policy_result,
       r.policy_violations,
       r.classifier_stage,
       r.model
  from public.ai_request_text t
  join public.ai_requests r
    on r.request_id = t.request_id
   and r.user_id = t.user_id
  join public.profiles p
    on p.id = t.user_id
 where t.retain_until > now()
   and p.ai_question_retention_notice_seen_at is not null
   and p.ai_question_retention_opted_out_at is null
   and p.ai_question_retention_opted_in_at is not null
   and t.created_at >= greatest(p.ai_question_retention_notice_seen_at,
                                p.ai_question_retention_opted_in_at);

revoke all on public.ai_replay_export from public, anon, authenticated;
grant select on public.ai_replay_export to service_role;
commit;
```

**3. Verify.**

```sql
select
  case
    when to_regclass('public.ai_replay_export') is null then 'absent'
    when md5(regexp_replace(pg_get_viewdef(to_regclass('public.ai_replay_export')), '\s+', ' ', 'g'))
           = 'cbfa456413cb4c7db8a026cbd2fdc7b0'
     and (select reloptions from pg_class
           where oid = to_regclass('public.ai_replay_export')) = array['security_invoker=true']
      then 'as in 20260927002000'
    else 'DIFFERENT - stop'
  end as definition,
  has_table_privilege('anon', 'public.ai_replay_export', 'select') as anon_reads,
  has_table_privilege('authenticated', 'public.ai_replay_export', 'select') as rider_reads,
  has_table_privilege('service_role', 'public.ai_replay_export', 'select') as service_reads,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_replay_export'
      and column_name in ('user_id', 'session_id', 'vehicle_id')) as identifying_columns,
  (select count(*) from public.ai_replay_export) as exportable_rows;
```

Expect `as in 20260927002000`, `false`, `false`, `true`, `0`, and
`exportable_rows` no more than
`select count(*) from public.ai_request_text` - zero until a rider has turned
question history on and asked something. `definition` is what proves the
opt-in, latest-opt-in and `retain_until` conditions and `security_invoker` are
the ones in the migration; the grant and column checks alone would pass a view
that exports every row. Anything but `as in 20260927002000` there: run the
rollback below and stop.

**4. Rollback.** Nothing depends on the view but the export script.

```sql
-- hosted-ai-replay-export-rollback
drop view if exists public.ai_replay_export;
```

### Apply session photos by hand

`20260926002000` carries the owner's decisions D2 and D3 of 2026-09-26 for the
mobile app. It adds `sessions.photo_url` (text, null until a photo is set), and
four owner-scoped policies on `storage.objects` for a public `session-photos`
bucket, the same four `vehicle-photos` has: a rider writes and deletes only under
their own `<user id>/` folder, and anyone holding the URL can view. The bucket
itself comes from `[storage.buckets.session-photos]` in `supabase/config.toml`,
which the SQL editor cannot read, so step 2 creates it with the same settings;
on a linked project `npx supabase seed buckets --linked` does the same. Hot tire
pressures (D2) need nothing here: they are optional keys inside the existing
`sessions.tires` JSON.

Apply and verify it before merging the pull request that adds the migration,
because the website reads the column from that deploy on. `deleteSession`
reads a session's `photo_url` and `deleteVehicle` reads it off every session on
the bike, to remove each photo from the public bucket before the rows go - a
row whose photo Storage did not confirm removing is kept, and the rider is told
to try again. On a database without the column PostgREST rejects those reads
with `42703`: every session delete fails, the bike delete confirmation cannot
load, and no bike can be deleted. The mobile app writes the column too. The
bike delete also needs the function in the next section.

The photo of a session is always the object `<user id>/<session id>.jpg`. After
a delete succeeds the website removes that path once more for every session it
deleted, which catches a phone upload that landed during the delete without
changing `photo_url` - a replacement under the same URL, or a first photo on a
session that had none. That second removal is best effort: a failure is
reported and the delete stands. It cannot see an upload that finishes after it,
so the mobile app carries the other half: upload with upsert to that path, then
set `photo_url`, and if that update affects zero rows - the session is gone -
remove the object it just uploaded.

**1. Precheck (read-only).**

```sql
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'sessions'
             and column_name = 'photo_url') as photo_url_column,
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (policyname like 'session-photos:%'
           or coalesce(qual, '') || coalesce(with_check, '') like '%session-photos%'))
    as session_photo_policies,
  (select count(*) from storage.buckets where id = 'session-photos') as bucket_rows,
  (select public from storage.buckets where id = 'session-photos') as bucket_public,
  (select allowed_mime_types from storage.buckets where id = 'session-photos') as bucket_mime_types,
  has_table_privilege('authenticated', 'public.sessions', 'update') as rider_can_update_sessions;
```

Expect `false`, `0`, then either `0` with two nulls (no bucket yet) or `1` with
the bucket's current settings (`npx supabase seed buckets --linked` already ran,
which the launch checklist and README both allow), then `true`.

- `photo_url_column` `true`, or `session_photo_policies` above `0`, means part of
  the migration is already there: stop and compare against the migration rather
  than applying over it, because `create policy` is not idempotent and the
  transaction below would roll back on the first duplicate.
- An existing bucket is fine whatever its settings. Step 2 upserts it, so a
  bucket reading anything but `true` and `{image/*}` is brought into line there,
  and step 3 checks that it was.
- `rider_can_update_sessions` must be `true` - it is the grant that lets a rider
  set `photo_url` on their own session (`20260719001100`); if it is `false`, that
  section of this runbook comes first.

**2. Apply.**

```sql
-- hosted-session-photos: mirror of supabase/migrations/20260926002000_add_session_photos.sql
-- plus the bucket that supabase/config.toml declares
begin;
alter table public.sessions add column if not exists photo_url text;

create policy "session-photos: select own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'session-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "session-photos: insert own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'session-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "session-photos: update own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'session-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'session-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "session-photos: delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'session-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

insert into storage.buckets (id, name, public, allowed_mime_types)
values ('session-photos', 'session-photos', true, array['image/*'])
on conflict (id) do update
  set public = excluded.public,
      allowed_mime_types = excluded.allowed_mime_types;
commit;
```

**3. Verify.**

```sql
with expected(policyname, cmd, has_using, has_check) as (
  values ('session-photos: select own', 'SELECT', true, false),
         ('session-photos: insert own', 'INSERT', false, true),
         ('session-photos: update own', 'UPDATE', true, true),
         ('session-photos: delete own', 'DELETE', true, false)
)
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'sessions'
             and column_name = 'photo_url') as photo_url_column,
  (select count(*) from pg_policies p join expected e using (policyname)
    where p.schemaname = 'storage' and p.tablename = 'objects'
      and p.cmd = e.cmd
      and p.permissive = 'PERMISSIVE'
      and p.roles = array['authenticated']::name[]
      and p.qual is not distinct from
            case when e.has_using then '((bucket_id = ''session-photos''::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))' end
      and p.with_check is not distinct from
            case when e.has_check then '((bucket_id = ''session-photos''::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))' end)
    as owner_scoped_policies,
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname not in (select policyname from expected)
      and (policyname like 'session-photos:%'
           or coalesce(qual, '') || coalesce(with_check, '') like '%session-photos%'))
    as other_session_photo_policies,
  (select public from storage.buckets where id = 'session-photos') as bucket_public,
  (select allowed_mime_types from storage.buckets where id = 'session-photos') as bucket_mime_types;
```

Expect `true`, `4`, `0`, `true`, `{image/*}`.

`owner_scoped_policies` counts a policy only when its command, role
(`authenticated` alone), and its `using` and `with check` expressions are exactly
the migration's - the bucket and the rider's own first folder, as Postgres
prints them back. A policy with the right name but a weaker predicate, a wider
role or a missing clause reads below `4`. `other_session_photo_policies` catches
an extra policy naming the bucket, which could widen access beside the four; a
policy on `storage.objects` that names no bucket at all is outside what it can
see. Row 22 of `scripts/sql/audit-migrations-against-database.sql` applies the
same exact comparison and then reads `present`.

**4. Rollback.** Dropping the column discards every `photo_url`, so this is for
before any photo is stored, and before the release that reads it deploys - once
it has, dropping the column breaks session and bike deletes as above. Storage refuses a delete from `storage.buckets` in
SQL ("Direct deletion from storage tables is not allowed"), so after this block
delete the `session-photos` bucket from the dashboard's Storage page, emptying it
first if it holds anything.

```sql
-- hosted-session-photos-rollback
begin;
drop policy if exists "session-photos: select own" on storage.objects;
drop policy if exists "session-photos: insert own" on storage.objects;
drop policy if exists "session-photos: update own" on storage.objects;
drop policy if exists "session-photos: delete own" on storage.objects;
alter table public.sessions drop column if exists photo_url;
commit;
```

### Guard bike deletes by hand

`20260926002100` adds `public.delete_vehicle_if_sessions_unchanged(uuid, jsonb)`,
which `deleteVehicle` calls instead of a plain delete. The website removes the
photos of every session on the bike first, then calls it with the sessions it
read; the function locks the bike and those sessions, and deletes only if they
are still exactly those - a session, or a photo under a new URL, synced from a
phone in between raises `TT409`, the bike stays, and the rider is asked to
reload. A photo uploaded to a session's existing path does not change its URL
and passes; the website removes every cascaded session's path again after the
delete for that case (see the section above). It is
`security invoker`, so RLS applies as for any rider query. Apply it right after
"Apply session photos by hand", and before merging the pull request that adds
it: without it every bike delete fails.

**1. Precheck (read-only).**

```sql
select to_regprocedure('public.delete_vehicle_if_sessions_unchanged(uuid,jsonb)') is not null
  as function_exists;
```

Expect `false`. `true` means it is already there: compare it with the migration
rather than applying over it (the block is `create or replace`, so re-running it
is harmless, but a different definition is a finding).

**2. Apply.**

```sql
-- hosted-delete-vehicle-guard: mirror of supabase/migrations/20260926002100_delete_vehicle_if_sessions_unchanged.sql
begin;
create or replace function public.delete_vehicle_if_sessions_unchanged(
  p_vehicle_id uuid,
  p_expected_sessions jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_photo_url text;
begin
  if jsonb_typeof(p_expected_sessions) is distinct from 'array' then
    raise exception 'p_expected_sessions must be an array' using errcode = '22023';
  end if;

  select v.photo_url
    into v_photo_url
    from public.vehicles v
   where v.id = p_vehicle_id
     and v.user_id = auth.uid()
     for update;

  if not found then
    return null;
  end if;

  perform 1
     from public.sessions s
    where s.vehicle_id = p_vehicle_id
      for update;

  if exists (
    (select s.id::text, s.photo_url
       from public.sessions s
      where s.vehicle_id = p_vehicle_id
     except
     select e ->> 'id', e ->> 'photo_url'
       from jsonb_array_elements(p_expected_sessions) e)
    union all
    (select e ->> 'id', e ->> 'photo_url'
       from jsonb_array_elements(p_expected_sessions) e
     except
     select s.id::text, s.photo_url
       from public.sessions s
      where s.vehicle_id = p_vehicle_id)
  ) then
    raise exception 'the sessions on this vehicle changed since they were read'
      using errcode = 'TT409';
  end if;

  delete from public.vehicles
   where id = p_vehicle_id
     and user_id = auth.uid();

  return jsonb_build_object('id', p_vehicle_id, 'photo_url', v_photo_url);
end;
$$;

revoke all on function public.delete_vehicle_if_sessions_unchanged(uuid, jsonb) from public, anon;
grant execute on function public.delete_vehicle_if_sessions_unchanged(uuid, jsonb) to authenticated;
commit;
```

**3. Verify.**

```sql
select
  p.prosecdef as security_definer,
  p.proconfig as settings,
  has_function_privilege('authenticated', p.oid, 'execute') as rider_can_execute,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
from pg_proc p
where p.oid = to_regprocedure('public.delete_vehicle_if_sessions_unchanged(uuid,jsonb)');
```

Expect one row: `false`, `{"search_path=\"\""}` (an empty `search_path`, as Postgres quotes it), `true`, `false`. Row 23 of
`scripts/sql/audit-migrations-against-database.sql` then reads `present`, and
`/api/health`'s `schema_contract` check stops naming the function.

**4. Rollback.** Only together with a rollback of the release that calls it,
since every bike delete fails without it.

```sql
-- hosted-delete-vehicle-guard-rollback
begin;
drop function if exists public.delete_vehicle_if_sessions_unchanged(uuid, jsonb);
commit;
```

### Apply the session create function by hand

`20260927002200` adds `public.create_session_with_laps(uuid, jsonb, jsonb, jsonb)`,
which `POST /api/mobile/sessions` writes every session through. It inserts the
session row, its laps (through `replace_session_laps`) and its environment in
one transaction, so a failure leaves none of them, and it is idempotent on the
session id the phone minted: a session of the rider's with that id is answered
as a replay and nothing is written. It refuses, before writing anything, a
vehicle that is not the rider's (`TT404`, which the route answers 400 so the
phone parks it). It is `security invoker`, so RLS applies as
for any rider query. Apply it before merging the pull request that adds it:
without it every session the phone sends is answered 503 and retried.

The website form writes through it too since the session writers were made one:
its server action mints an id per save and makes the same call. So on a project
without this function no session can be saved from the website either, and on
one without "Close session ownership, deleted-session replays and the free-plan
race by hand" below the form saves with no free-plan cap at all, since that
block is where the cap is counted. Confirm both are applied (each block's own
verification) before deploying that release.

**1. Precheck (read-only).**

```sql
select to_regprocedure('public.create_session_with_laps(uuid,jsonb,jsonb,jsonb)') is not null
  as function_exists;
```

Expect `false`. `true` means it is already there: compare it with the migration
rather than applying over it (the block is `create or replace`, so re-running it
is harmless, but a different definition is a finding).

**2. Apply.**

```sql
-- hosted-session-create: mirror of supabase/migrations/20260927002200_add_create_session_with_laps.sql
begin;
create or replace function public.create_session_with_laps(
  p_session_id uuid,
  p_session jsonb,
  p_laps jsonb,
  p_environment jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  if auth.uid() is null then
    raise exception 'create_session_with_laps needs a signed-in rider' using errcode = '42501';
  end if;

  select s.* into v_session
    from public.sessions s
   where s.id = p_session_id
     and s.user_id = auth.uid();

  if found then
    return jsonb_build_object('replayed', true, 'session', to_jsonb(v_session));
  end if;

  if not exists (
    select 1
      from public.vehicles v
     where v.id = (p_session ->> 'vehicle_id')::uuid
       and v.user_id = auth.uid()
  ) then
    raise exception 'the vehicle this session names is not one of this rider''s'
      using errcode = 'TT404';
  end if;

  begin
    insert into public.sessions (
      id, user_id, vehicle_id, track_id, track_name, layout_id, layout_name,
      date, start_time, session_number, conditions, tires, suspension,
      alignment, enabled_modules, extra_modules, notes
    )
    select
      p_session_id, auth.uid(), r.vehicle_id, r.track_id, r.track_name, r.layout_id, r.layout_name,
      r.date, r.start_time, r.session_number, r.conditions, r.tires, r.suspension,
      r.alignment, coalesce(r.enabled_modules, '{}'::jsonb), r.extra_modules, r.notes
    from jsonb_populate_record(null::public.sessions, p_session) r
    returning * into v_session;
  exception when unique_violation then
    select s.* into v_session
      from public.sessions s
     where s.id = p_session_id
       and s.user_id = auth.uid();

    if found then
      return jsonb_build_object('replayed', true, 'session', to_jsonb(v_session));
    end if;

    raise;
  end;

  perform public.replace_session_laps(auth.uid(), p_session_id, p_laps, '[]'::jsonb);

  if p_environment is not null then
    insert into public.session_environment (
      user_id, session_id, ambient_temperature_c, track_temperature_c,
      humidity_percent, weather_condition, surface_condition, source
    )
    select
      auth.uid(), p_session_id, r.ambient_temperature_c, r.track_temperature_c,
      r.humidity_percent, r.weather_condition, r.surface_condition, coalesce(r.source, 'manual')
    from jsonb_populate_record(null::public.session_environment, p_environment) r;
  end if;

  return jsonb_build_object('replayed', false, 'session', to_jsonb(v_session));
end;
$$;

revoke all on function public.create_session_with_laps(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_session_with_laps(uuid, jsonb, jsonb, jsonb) to authenticated;
commit;
```

**3. Verify.**

```sql
-- hosted-session-create-verify
select
  p.prosecdef as security_definer,
  p.proconfig as settings,
  has_function_privilege('authenticated', p.oid, 'execute') as rider_can_execute,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
  md5(p.prosrc) = '8c9d41c909128fbf696780c5b0c0d5ce' as definition_is_the_migration
from pg_proc p
where p.oid = to_regprocedure('public.create_session_with_laps(uuid,jsonb,jsonb,jsonb)');
```

Expect one row: `false`, `{"search_path=\"\""}` (an empty `search_path`, as Postgres quotes it), `true`, `false`, `true`.
The last column compares the md5 of the installed function body with the body
in the migration, so it is `true` only when what is installed is exactly the
block above: an older copy, a hand edit or a partial paste all read `false`. If
it reads `false`, run the apply block again rather than editing the function in
place - unless "Close session ownership, deleted-session replays and the
free-plan race by hand" below has been applied, which replaces the body on
purpose; its own verify query is then the one to read. Row 25 of
`scripts/sql/audit-migrations-against-database.sql` then reads `present`, and
`/api/health`'s `schema_contract` check stops naming the function.

**4. Rollback.** Only together with a rollback of the release that calls it,
since every session the phone sends fails without it.

```sql
-- hosted-session-create-rollback
begin;
drop function if exists public.create_session_with_laps(uuid, jsonb, jsonb, jsonb);
commit;
```

### Close session ownership, deleted-session replays and the free-plan race by hand

`20260928002300` makes three changes to how a session is written, and they are
applied together so one paste takes all three:

- **A session's vehicle has to be the rider's.** `sessions: insert own` and
  `sessions: update own` now also require `vehicle_id` to name one of the
  rider's own vehicles, so no path - the website form, the phone, or a request
  crafted against the Data API - can store a session on, or move one onto,
  someone else's vehicle. The website form answers the refusal with "not in
  your garage"; the phone already had its own check and keeps it.
- **A deleted session stays deleted.** A new table, `deleted_sessions`, records
  the id of every deleted session through a trigger on `sessions`, and
  `create_session_with_laps` answers a create on a recorded id as a replay that
  wrote nothing, so a phone retrying a save whose answer was lost cannot bring
  back a session the rider has since deleted. Riders can read their own rows
  and write none.
- **The free-plan cap holds when two saves arrive together.**
  `create_session_with_laps` now counts a free rider's sessions itself, under a
  per-rider lock, and refuses the eleventh as `TT402` (answered 402, which the
  phone parks). Its signature is unchanged.

Apply it before merging the pull request that adds it. The release must not
deploy first: it reads `deleted_sessions` before every phone save, so every
phone save would be answered 503 until the table exists. Until the release
deploys, the release before it keeps working: its phone path counts first, as
it always did, and a save that loses the race is answered 503 and retried
rather than stored. A replay of a deleted session in that window is also
answered 503 and retried, and is answered as handled once the release is out.

**1. Precheck (read-only).**

```sql
-- hosted-session-ownership-precheck
select
  to_regclass('public.deleted_sessions') is not null as tombstones_exist,
  to_regprocedure('public.record_deleted_session()') is not null as trigger_function_exists,
  (select md5(p.prosrc) = '8c9d41c909128fbf696780c5b0c0d5ce'
     from pg_proc p
    where p.oid = to_regprocedure('public.create_session_with_laps(uuid,jsonb,jsonb,jsonb)'))
    as create_function_is_20260927002200,
  (select count(*)
     from public.sessions s
     join public.vehicles v on v.id = s.vehicle_id
    where v.user_id <> s.user_id) as sessions_on_another_riders_vehicle,
  (select count(*) from pg_policies p
     join (values
       ('sessions: select own', 'Users can select own sessions', 'SELECT', '(auth.uid() = user_id)', null),
       ('sessions: insert own', 'Users can insert own sessions', 'INSERT', null, '(auth.uid() = user_id)'),
       ('sessions: update own', 'Users can update own sessions', 'UPDATE', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
       ('sessions: delete own', 'Users can delete own sessions', 'DELETE', '(auth.uid() = user_id)', null)
     ) as e(repo_name, hosted_name, cmd, qual, with_check)
       on p.policyname in (e.repo_name, e.hosted_name)
    where p.schemaname = 'public' and p.tablename = 'sessions'
      and p.cmd = e.cmd
      and p.permissive = 'PERMISSIVE'
      and p.roles = array['public']::name[]
      and p.qual is not distinct from e.qual
      and p.with_check is not distinct from e.with_check) = 4
  and (select count(*) from pg_policies p
        where p.schemaname = 'public' and p.tablename = 'sessions') = 4
    as session_policies_are_a_known_baseline;

select tablename, policyname, cmd, permissive, roles, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename in ('sessions', 'deleted_sessions')
 order by tablename, policyname;
```

Expect `false`, `false`, `true`, `0`, `true` from the first query. `true` in either of
the first two means some of this is already there: run the verify query below
rather than applying over it. `false` in the third means the installed function
is not the one "Apply the session create function by hand" installs - apply
that section first. A count above `0` in the last column is a finding to decide
before going on: those sessions sit on another rider's vehicle, their own rider
could no longer edit them once the update policy checks the vehicle, and the
vehicle's owner deleting it would take them.

The last column is `true` when `sessions` has exactly four policies and each
is one the apply block knows: `PERMISSIVE` for `{public}`, the command its name
says, and `(auth.uid() = user_id)` as `qual` on select, update and delete and
as `with_check` on insert and update. **The hosted project names them
differently from the repository**: "Users can select own sessions", "Users can
insert own sessions", "Users can update own sessions" and "Users can delete own
sessions", where the baseline migration says "sessions: select own" and so on,
because the baseline was reconstructed rather than read off the project. Both
sets pass this column. The apply block renames the hosted ones to the
repository's names before it changes them, so after it the hosted project
carries the names the verify query and every later migration expect. `false`
is a finding to decide before going on: the second query lists each policy
with its command, roles and expressions so the difference can be read off.

**2. Apply.**

```sql
-- hosted-session-ownership: mirror of supabase/migrations/20260928002300_session_vehicle_ownership_and_deleted_sessions.sql
begin;
create table if not exists public.deleted_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  deleted_at timestamptz not null default now(),
  primary key (user_id, session_id)
);

alter table public.deleted_sessions enable row level security;

create policy "deleted_sessions: select own"
  on public.deleted_sessions for select
  using (auth.uid() = user_id);

-- A rider reads their own - `create_session_with_laps` is security invoker - and
-- writes none: only the trigger does. The revoke comes first because the hosted
-- project's legacy default privileges hand every new table to anon and
-- authenticated with `grant all`.
revoke all on public.deleted_sessions from public, anon, authenticated;
grant select on public.deleted_sessions to authenticated;

-- security definer because it writes a table no rider may insert into, and
-- because an account delete runs as the auth service, which holds no grant on
-- it. It cannot be called directly - it returns `trigger` - but the execute
-- decision is written down here as for every security definer function.
create or replace function public.record_deleted_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from auth.users u where u.id = old.user_id) then
    insert into public.deleted_sessions (user_id, session_id)
    values (old.user_id, old.id)
    on conflict do nothing;
  end if;
  return old;
end;
$$;

revoke all on function public.record_deleted_session() from public, anon, authenticated;

drop trigger if exists sessions_record_deleted on public.sessions;
create trigger sessions_record_deleted
  after delete on public.sessions
  for each row execute function public.record_deleted_session();

do $$
declare
  v_policy record;
begin
  for v_policy in
    select r.hosted_name, r.repo_name
      from (values
        ('Users can select own sessions', 'sessions: select own'),
        ('Users can insert own sessions', 'sessions: insert own'),
        ('Users can update own sessions', 'sessions: update own'),
        ('Users can delete own sessions', 'sessions: delete own')
      ) as r(hosted_name, repo_name)
     where exists (
       select 1
         from pg_catalog.pg_policies p
        where p.schemaname = 'public'
          and p.tablename = 'sessions'
          and p.policyname = r.hosted_name
     )
  loop
    execute pg_catalog.format('alter policy %I on public.sessions rename to %I', v_policy.hosted_name, v_policy.repo_name);
  end loop;
end;
$$;

alter policy "sessions: insert own"
  on public.sessions
  with check (
    auth.uid() = user_id
    and exists (
      select 1
        from public.vehicles v
       where v.id = sessions.vehicle_id
         and v.user_id = auth.uid()
    )
  );

alter policy "sessions: update own"
  on public.sessions
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1
        from public.vehicles v
       where v.id = sessions.vehicle_id
         and v.user_id = auth.uid()
    )
  );

create or replace function public.create_session_with_laps(
  p_session_id uuid,
  p_session jsonb,
  p_laps jsonb,
  p_environment jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_unlimited boolean;
begin
  if auth.uid() is null then
    raise exception 'create_session_with_laps needs a signed-in rider' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('create_session_with_laps:' || auth.uid()::text, 0));

  select s.* into v_session
    from public.sessions s
   where s.id = p_session_id
     and s.user_id = auth.uid();

  if found then
    return jsonb_build_object('replayed', true, 'session', to_jsonb(v_session));
  end if;

  if exists (
    select 1
      from public.deleted_sessions d
     where d.user_id = auth.uid()
       and d.session_id = p_session_id
  ) then
    return jsonb_build_object('replayed', true, 'deleted', true, 'session', null);
  end if;

  select p.tier = 'pro'
         or (p.beta_access_expires_at > now()
             and (p.beta_access_started_at is null or p.beta_access_started_at <= now()))
    into v_unlimited
    from public.profiles p
   where p.id = auth.uid();

  if not coalesce(v_unlimited, false)
     and (select count(*) from public.sessions s where s.user_id = auth.uid()) >= 10 then
    raise exception 'the free plan holds 10 sessions' using errcode = 'TT402';
  end if;

  if not exists (
    select 1
      from public.vehicles v
     where v.id = (p_session ->> 'vehicle_id')::uuid
       and v.user_id = auth.uid()
  ) then
    raise exception 'the vehicle this session names is not one of this rider''s'
      using errcode = 'TT404';
  end if;

  begin
    insert into public.sessions (
      id, user_id, vehicle_id, track_id, track_name, layout_id, layout_name,
      date, start_time, session_number, conditions, tires, suspension,
      alignment, enabled_modules, extra_modules, notes
    )
    select
      p_session_id, auth.uid(), r.vehicle_id, r.track_id, r.track_name, r.layout_id, r.layout_name,
      r.date, r.start_time, r.session_number, r.conditions, r.tires, r.suspension,
      r.alignment, coalesce(r.enabled_modules, '{}'::jsonb), r.extra_modules, r.notes
    from jsonb_populate_record(null::public.sessions, p_session) r
    returning * into v_session;
  exception when unique_violation then
    select s.* into v_session
      from public.sessions s
     where s.id = p_session_id
       and s.user_id = auth.uid();

    if found then
      return jsonb_build_object('replayed', true, 'session', to_jsonb(v_session));
    end if;

    raise;
  end;

  perform public.replace_session_laps(auth.uid(), p_session_id, p_laps, '[]'::jsonb);

  if p_environment is not null then
    insert into public.session_environment (
      user_id, session_id, ambient_temperature_c, track_temperature_c,
      humidity_percent, weather_condition, surface_condition, source
    )
    select
      auth.uid(), p_session_id, r.ambient_temperature_c, r.track_temperature_c,
      r.humidity_percent, r.weather_condition, r.surface_condition, coalesce(r.source, 'manual')
    from jsonb_populate_record(null::public.session_environment, p_environment) r;
  end if;

  return jsonb_build_object('replayed', false, 'session', to_jsonb(v_session));
end;
$$;

revoke all on function public.create_session_with_laps(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_session_with_laps(uuid, jsonb, jsonb, jsonb) to authenticated;
commit;
```

The block is one transaction, so a failure applies none of it. It is not
re-runnable once it has succeeded - `create policy` has no `if not exists` -
and a second paste fails on that statement and changes nothing.

**3. Verify.**

```sql
-- hosted-session-ownership-verify
select
  (select md5(p.prosrc) = 'd511ff7c7be1ab357c5a1dd207c639ab'
          and not p.prosecdef
          and p.proconfig = array['search_path=""']
          and has_function_privilege('authenticated', p.oid, 'execute')
          and not has_function_privilege('anon', p.oid, 'execute')
     from pg_proc p
    where p.oid = to_regprocedure('public.create_session_with_laps(uuid,jsonb,jsonb,jsonb)'))
    as create_function_is_the_migration,
  (select md5(p.prosrc) = 'f683960a5a0bd7344368cc936e3120b4'
          and p.prosecdef
          and p.proconfig = array['search_path=""']
          and not has_function_privilege('authenticated', p.oid, 'execute')
          and not has_function_privilege('anon', p.oid, 'execute')
     from pg_proc p
    where p.oid = to_regprocedure('public.record_deleted_session()'))
    as trigger_function_is_the_migration,
  (exists (select 1 from pg_trigger t
            where t.tgrelid = to_regclass('public.sessions')
              and t.tgname = 'sessions_record_deleted'
              and t.tgfoid = to_regprocedure('public.record_deleted_session()')
              and t.tgtype = 9
              and t.tgenabled = 'O'
              and t.tgnargs = 0
              and t.tgqual is null
              and not t.tgisinternal)
   and (select count(*) from pg_trigger t
         where t.tgfoid = to_regprocedure('public.record_deleted_session()')) = 1)
    as trigger_is_exact,
  case when to_regclass('public.deleted_sessions') is null then false
       else (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.deleted_sessions'))
            and has_table_privilege('authenticated', 'public.deleted_sessions', 'select')
            and not has_table_privilege('authenticated', 'public.deleted_sessions', 'insert, update, delete')
            and not has_table_privilege('anon', 'public.deleted_sessions', 'select, insert, update, delete')
  end as tombstones_are_read_only_to_riders,
  (select count(*) from pg_policies p
     join (values
       ('sessions', 'sessions: select own', 'SELECT', '(auth.uid() = user_id)', null),
       ('sessions', 'sessions: insert own', 'INSERT', null, '7c9b3da91045db80e54e45052117e6e2'),
       ('sessions', 'sessions: update own', 'UPDATE', '(auth.uid() = user_id)', '7c9b3da91045db80e54e45052117e6e2'),
       ('sessions', 'sessions: delete own', 'DELETE', '(auth.uid() = user_id)', null),
       ('deleted_sessions', 'deleted_sessions: select own', 'SELECT', '(auth.uid() = user_id)', null)
     ) as e(tablename, policyname, cmd, qual, with_check_md5)
       on e.tablename = p.tablename and e.policyname = p.policyname
    where p.schemaname = 'public'
      and p.cmd = e.cmd
      and p.permissive = 'PERMISSIVE'
      and p.roles = array['public']::name[]
      and p.qual is not distinct from e.qual
      and md5(replace(p.with_check, 'public.vehicles', 'vehicles')) is not distinct from e.with_check_md5)
    as exact_policies,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename in ('sessions', 'deleted_sessions'))
    as all_policies;
```

Expect one row: `true`, `true`, `true`, `true`, `5`, `5`. Every column proves
an object by what it is, not by its name:

- The two md5 columns compare each installed function body with the
  migration's, so an older copy, a hand edit or a partial paste reads `false`.
- `trigger_is_exact` is `true` only for an `AFTER DELETE ... FOR EACH ROW`
  trigger on `sessions` that calls `record_deleted_session()`, is enabled, has
  no `WHEN` clause and no arguments, and is the only trigger calling that
  function. One that kept the name but fires per statement, on another event
  or into another function writes no record, and a phone retry would then
  bring a deleted session back.
- `exact_policies` counts the policies on `sessions` and `deleted_sessions`
  whose whole definition matches: name, command, `PERMISSIVE`, role `public`,
  `using`, and `with check`. The apply block's `alter policy` cannot change a
  policy's command, so a policy of the right name made `for all` by hand
  survives the paste and is caught only here. The vehicle check is compared by
  its md5 as `pg_policies` prints it; the `replace` takes out the one
  qualifier that depends on the reader's `search_path`, so it reads the same in
  the SQL editor as anywhere else.
- `all_policies` counts every policy on the two tables. Permissive policies
  are combined with OR, so a sixth one - added by hand in the dashboard, say -
  can let through a row the vehicle check refuses, or show riders each other's
  records, while all five named ones still match.

Any other value is a finding: run the precheck's second query to see which
policy differs. Row 26 of `scripts/sql/audit-migrations-against-database.sql`
applies the same checks and then reads `present`, and row 25 still does.

**4. Rollback.** Only together with a rollback of the release that expects it:
that release reads `deleted_sessions` before every phone save, so without the
table every phone save is answered 503 and retried, for every rider; and it no
longer counts a phone save's sessions itself, so without the function's cap a
free rider's phone saves would not be capped at all. It restores the
20260927002200 function, the baseline's two policy expressions, and drops the
trigger and the table - with every id recorded in it. It keeps the policy names
the apply block gave the hosted project ("sessions: insert own" and so on)
rather than renaming them back to "Users can ... own sessions": nothing reads a
policy by name except these blocks and the migrations, all of which use the
repository's names, and the apply block renames only what it finds, so it can
be pasted again after a rollback either way.

```sql
-- hosted-session-ownership-rollback
begin;
create or replace function public.create_session_with_laps(
  p_session_id uuid,
  p_session jsonb,
  p_laps jsonb,
  p_environment jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  if auth.uid() is null then
    raise exception 'create_session_with_laps needs a signed-in rider' using errcode = '42501';
  end if;

  select s.* into v_session
    from public.sessions s
   where s.id = p_session_id
     and s.user_id = auth.uid();

  if found then
    return jsonb_build_object('replayed', true, 'session', to_jsonb(v_session));
  end if;

  if not exists (
    select 1
      from public.vehicles v
     where v.id = (p_session ->> 'vehicle_id')::uuid
       and v.user_id = auth.uid()
  ) then
    raise exception 'the vehicle this session names is not one of this rider''s'
      using errcode = 'TT404';
  end if;

  begin
    insert into public.sessions (
      id, user_id, vehicle_id, track_id, track_name, layout_id, layout_name,
      date, start_time, session_number, conditions, tires, suspension,
      alignment, enabled_modules, extra_modules, notes
    )
    select
      p_session_id, auth.uid(), r.vehicle_id, r.track_id, r.track_name, r.layout_id, r.layout_name,
      r.date, r.start_time, r.session_number, r.conditions, r.tires, r.suspension,
      r.alignment, coalesce(r.enabled_modules, '{}'::jsonb), r.extra_modules, r.notes
    from jsonb_populate_record(null::public.sessions, p_session) r
    returning * into v_session;
  exception when unique_violation then
    select s.* into v_session
      from public.sessions s
     where s.id = p_session_id
       and s.user_id = auth.uid();

    if found then
      return jsonb_build_object('replayed', true, 'session', to_jsonb(v_session));
    end if;

    raise;
  end;

  perform public.replace_session_laps(auth.uid(), p_session_id, p_laps, '[]'::jsonb);

  if p_environment is not null then
    insert into public.session_environment (
      user_id, session_id, ambient_temperature_c, track_temperature_c,
      humidity_percent, weather_condition, surface_condition, source
    )
    select
      auth.uid(), p_session_id, r.ambient_temperature_c, r.track_temperature_c,
      r.humidity_percent, r.weather_condition, r.surface_condition, coalesce(r.source, 'manual')
    from jsonb_populate_record(null::public.session_environment, p_environment) r;
  end if;

  return jsonb_build_object('replayed', false, 'session', to_jsonb(v_session));
end;
$$;

revoke all on function public.create_session_with_laps(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_session_with_laps(uuid, jsonb, jsonb, jsonb) to authenticated;

alter policy "sessions: insert own"
  on public.sessions
  with check (auth.uid() = user_id);

alter policy "sessions: update own"
  on public.sessions
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists sessions_record_deleted on public.sessions;
drop function if exists public.record_deleted_session();
drop table if exists public.deleted_sessions;
commit;
```

### Take back a refused save's track safely, by hand

`20260930002400` adds `public.delete_auto_created_track_if_unused(uuid)`. A
session save that names a circuit the rider has never logged creates their own
track first and then calls `create_session_with_laps`; when that call is refused
(the free-plan cap, a vehicle that is not theirs, a constraint) the save takes
the track back. It used to do that with a plain delete, which could take the
track out from under a session another save had just stored against it, leaving
that session with a name and no track. The function locks the track row, and
deletes it only when it is the caller's own unseeded track and no session
references it. Apply it before merging the pull request that calls it.

Without it nothing is refused that would otherwise save: the save's take-back
call fails, is reported to Sentry as `session-track-rollback`, and leaves a
stray custom track in that rider's list - which on the free plan spends one of
their three slots. `/api/health`'s `schema_contract` names the function until it
is applied.

**1. Precheck (read-only).**

```sql
-- hosted-auto-track-rollback-precheck
select
  to_regprocedure('public.delete_auto_created_track_if_unused(uuid)') is not null as function_exists,
  has_table_privilege('authenticated', 'public.tracks', 'update') as rider_can_lock_tracks;
```

Expect `false`, `true`. `function_exists = true` means it is already there:
compare it with the migration rather than applying over it (the block is
`create or replace`, so re-running it is harmless, but a different definition is
a finding). `rider_can_lock_tracks = false` stops here: the function locks the
track `for update` as the rider, which needs that privilege
(`20260719001100`), and would fail on every call without it.

**2. Apply.**

```sql
-- hosted-auto-track-rollback: mirror of supabase/migrations/20260930002400_delete_auto_created_track_if_unused.sql
begin;
create or replace function public.delete_auto_created_track_if_unused(p_track_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
     from public.tracks t
    where t.id = p_track_id
      and t.created_by = auth.uid()
      and not t.is_seeded
      for update;

  if not found then
    return false;
  end if;

  if exists (select 1 from public.sessions s where s.track_id = p_track_id) then
    return false;
  end if;

  delete from public.tracks t
   where t.id = p_track_id
     and t.created_by = auth.uid()
     and not t.is_seeded;

  return true;
end;
$$;

revoke all on function public.delete_auto_created_track_if_unused(uuid) from public, anon;
grant execute on function public.delete_auto_created_track_if_unused(uuid) to authenticated;
commit;
```

**3. Verify.**

```sql
-- hosted-auto-track-rollback-verify
select
  p.prosecdef as security_definer,
  p.proconfig as settings,
  has_function_privilege('authenticated', p.oid, 'execute') as rider_can_execute,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
  md5(p.prosrc) = '7f101aee6dea2c710011d0684e0faa13' as definition_is_the_migration
from pg_proc p
where p.oid = to_regprocedure('public.delete_auto_created_track_if_unused(uuid)');
```

Expect one row: `false`, `{"search_path=\"\""}` (an empty `search_path`, as Postgres quotes it), `true`, `false`, `true`.
The last column compares the md5 of the installed function body with the body
in the migration, so it is `true` only when what is installed is exactly the
block above. If it reads `false`, run the apply block again rather than editing
the function in place - unless "Let the track take-back see every rider's
sessions, by hand" below has been applied, which replaces the body on purpose;
its own verify query is then the one to read. Row 27 of
`scripts/sql/audit-migrations-against-database.sql` then reads `present`, and
`/api/health`'s `schema_contract` check stops naming the function.

**4. Rollback.** Harmless to the saves themselves: without the function a
refused save keeps the track it created, as described above.

```sql
-- hosted-auto-track-rollback-rollback
begin;
drop function if exists public.delete_auto_created_track_if_unused(uuid);
commit;
```

### Let the track take-back see every rider's sessions, by hand

`20261001002500` follows "Take back a refused save's track safely, by hand"
above and needs it applied first. That function checked "does any session use
this track?" as the rider, so it saw only their own sessions - and another
rider's session can point at a rider's custom track, since the foreign key does
not know the track is private. The take-back then deleted the track and cleared
that other rider's link. This adds `public.auto_created_track_is_referenced(uuid)`,
`security definer` so it sees every session, answering only for the caller's
own auto-created track (null for any other track, so it cannot be used to
probe), and makes the take-back call it. The take-back itself stays
`security invoker`. Apply it before merging the pull request that adds it.

**1. Precheck (read-only).**

```sql
-- hosted-track-reference-check-precheck
select
  (select md5(p.prosrc) = '7f101aee6dea2c710011d0684e0faa13'
     from pg_proc p
    where p.oid = to_regprocedure('public.delete_auto_created_track_if_unused(uuid)')) as take_back_is_20260930002400,
  to_regprocedure('public.auto_created_track_is_referenced(uuid)') is not null as check_exists;
```

Expect `true`, `false`. A null or `false` first column means the block above has
not been applied, or was changed: apply and verify it first. `check_exists =
true` means this block already ran; read its verify instead of applying again.

**2. Apply.**

```sql
-- hosted-track-reference-check: mirror of supabase/migrations/20261001002500_auto_created_track_reference_check_sees_every_session.sql
begin;
create or replace function public.auto_created_track_is_referenced(p_track_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.tracks t
     where t.id = p_track_id
       and t.created_by = auth.uid()
       and not t.is_seeded
  ) then
    return null;
  end if;

  return exists (select 1 from public.sessions s where s.track_id = p_track_id);
end;
$$;

revoke all on function public.auto_created_track_is_referenced(uuid) from public, anon, authenticated;
grant execute on function public.auto_created_track_is_referenced(uuid) to authenticated;

create or replace function public.delete_auto_created_track_if_unused(p_track_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
     from public.tracks t
    where t.id = p_track_id
      and t.created_by = auth.uid()
      and not t.is_seeded
      for update;

  if not found then
    return false;
  end if;

  if public.auto_created_track_is_referenced(p_track_id) is not false then
    return false;
  end if;

  delete from public.tracks t
   where t.id = p_track_id
     and t.created_by = auth.uid()
     and not t.is_seeded;

  return true;
end;
$$;
commit;
```

**3. Verify.**

```sql
-- hosted-track-reference-check-verify
select
  p.proname as function,
  p.prosecdef as security_definer,
  p.proconfig as settings,
  has_function_privilege('authenticated', p.oid, 'execute') as rider_can_execute,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
  md5(p.prosrc) in ('8b42dbdda465b809e74afd84c9e21e2e', '65913c39a7070ab1b68c76b2fa3093fc') as definition_is_the_migration
from pg_proc p
where p.oid in (
  to_regprocedure('public.auto_created_track_is_referenced(uuid)'),
  to_regprocedure('public.delete_auto_created_track_if_unused(uuid)')
)
order by p.proname;
```

Expect two rows. `auto_created_track_is_referenced`: `true`, `{"search_path=\"\""}`, `true`, `false`, `true`.
`delete_auto_created_track_if_unused`: `false`, `{"search_path=\"\""}`, `true`, `false`, `true`.
A `false` in the last column means a body is not this migration's: run the apply
block again rather than editing in place. Rows 27 and 28 of
`scripts/sql/audit-migrations-against-database.sql` then read `present`. The
previous block's verify reads `false` in its last column from here on, by
design: this block replaces that body.

**4. Rollback.** Puts back the `20260930002400` take-back, which sees only the
rider's own sessions, and drops the check.

```sql
-- hosted-track-reference-check-rollback
begin;
create or replace function public.delete_auto_created_track_if_unused(p_track_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
     from public.tracks t
    where t.id = p_track_id
      and t.created_by = auth.uid()
      and not t.is_seeded
      for update;

  if not found then
    return false;
  end if;

  if exists (select 1 from public.sessions s where s.track_id = p_track_id) then
    return false;
  end if;

  delete from public.tracks t
   where t.id = p_track_id
     and t.created_by = auth.uid()
     and not t.is_seeded;

  return true;
end;
$$;

drop function if exists public.auto_created_track_is_referenced(uuid);
commit;
```

### Apply the service book tables by hand

`20261010000100` and `20261010000200` are the schema of the digital service book
(owner's go-ahead 2026-10-08): one book per bike, its maintenance items, the
entries a rider logs, every entry's edit history, the hour-meter and odometer
readings, and the rider's per-session usage weights and due-date overrides. They
are applied together, in one transaction. Nothing in the app reads or writes
these tables yet - the screens are a later pull request - so there is no deploy
ordering to meet: apply and verify before merging the pull request that adds
them, so the next one can rely on them.

What the paste puts in place, beyond the tables: an entry's `logged_at` is the
server's (no rider grant reaches it, and a trigger pins it for the service role
too), its `logged_by` is the rider who wrote it and never changes, every change to an entry writes a revision that
no API role can change or remove, `delete` on entries is granted to nobody (a
rider removes one by setting `deleted_at`), an entry carrying a reading
writes a `vehicle_readings` row, and a rider's reading is never changed - a
correction is a new reading that supersedes it. Each table revokes before it grants, because
the hosted project still hands every new table to `anon` and `authenticated`
with Supabase's legacy `grant all` defaults.

**1. Precheck (read-only).**

```sql
-- hosted-service-book-precheck
select
  to_regclass('public.service_books') is not null as service_books_exists,
  to_regclass('public.session_usage_weights') is not null as usage_weights_exists,
  to_regprocedure('public.service_book_owned(uuid)') is not null as owned_helper_exists,
  to_regprocedure('public.set_updated_at()') is not null as set_updated_at_exists,
  has_table_privilege('authenticated', 'public.vehicles', 'select') as rider_can_read_vehicles;
```

Expect `false`, `false`, `false`, `true`, `true`.

- Any of the first three `true` means part of this is already there: stop and
  compare against the migrations rather than applying over it, because
  `create policy` is not idempotent and the transaction below would roll back on
  the first duplicate.
- `set_updated_at_exists` `false` means `20260422000400` is missing, and every
  table here uses its trigger function: that comes first.
- `rider_can_read_vehicles` `false` means the Data API grants are missing, and
  every policy here reads `vehicles` as the rider: apply "Apply the Data API
  grants by hand" first.

**2. Apply.**

```sql
-- hosted-service-book: mirror of supabase/migrations/20261010000100_add_service_book.sql
-- and supabase/migrations/20261010000200_add_service_usage_overrides.sql
begin;
-- The digital service book, slice 1: one book per bike, its maintenance items,
-- the entries a rider logs against them, the edit history of every entry, and
-- the hour-meter / odometer readings the due math will read.
--
-- Owner decisions, 2026-10-08 (the service book grill). The ones this schema
-- carries:
--
-- - HONEST HISTORY. An entry records when it was actually logged, apart from the
--   service date the rider types. `logged_at` is the server's clock and nothing
--   a rider sends can move it: it is not in the columns `authenticated` may
--   insert or update, and a trigger pins it on insert and keeps it on every
--   update, so even the service role cannot date an entry ahead or behind.
--   `logged_by` is the rider's own id on a rider's insert and is kept on every
--   update; the service role, which has no rider, supplies it on insert. A buyer
--   reads a back-filled entry labelled as back-filled, worked out from these two
--   dates.
-- - EDITS ARE KEPT. Every change to an entry, its items or its parts writes a
--   snapshot to `service_entry_revisions`, from a trigger, so a write through
--   PostgREST cannot skip the record. A rider reads their history and writes
--   none of it; not even the service role may change or remove a revision.
--   One transaction is one revision: an entry saved together with its items is
--   revision 1, not three, so "edited N times" counts edits a rider made.
-- - DELETE IS SOFT. A rider removes an entry by setting `deleted_at`, which
--   writes a `deleted` revision; `delete` is granted to no API role, the service
--   role included, so an entry is hard-deleted only by a cascade: its vehicle's,
--   or its book's, which the service role can still delete. The buyer's view will
--   show "N entries removed by the owner" without the content.
-- - THE RIDER SHAPES THE BOOK. `service_book_fields` is the entry layout a rider
--   adjusts - built-in fields switched off, custom fields added - and custom
--   values live in `service_entries.custom_fields`, keyed by field id.
-- - READINGS ARE THE TRUTH. An entry carrying a reading also writes a
--   `vehicle_readings` row (`source = 'entry'`), through a trigger, so the usage
--   math has one table to read; estimates from logged sessions are only the
--   fallback between readings and are not stored here. A rider's own reading is
--   never changed: a correction is a new reading naming the one it
--   `supersedes_id`, so the old value stays in the history, and the bike's usage
--   is the latest reading nothing supersedes.
--
-- OWNERSHIP RUNS THROUGH THE BOOK, NOT A user_id. A book belongs to whoever owns
-- its vehicle, and every child row reaches that through `service_book_owned`,
-- written once so every policy reads the same rule. It and
-- `service_entry_owned` are security invoker, so RLS on `vehicles` still applies
-- inside them and the grant is not the access control.
--
-- SHAPED FOR A LATER TRANSFER, WHICH THIS DOES NOT BUILD. The owner's rule
-- (2026-10-08): at handover the bike's history is COPIED to the buyer, the
-- seller keeps theirs, and after that the two copies diverge. So a book is never
-- moved between riders; the buyer gets a new book on their own vehicle row,
-- `transferred_from_book_id` and `transferred_at` say where it came from, a
-- copied entry carries `copied_from_entry_id`, and a reading carried over is
-- `source = 'transfer'`. None of those is writable by a rider; on
-- `service_books` that is the grants alone, with no pin, so the service role
-- can set a book's transfer origin. For the copy to
-- keep the seller's dates honest, the pins below apply to the Data API roles
-- only: a function running as the owner (the transfer's `security definer`
-- copy) may carry `logged_at`, `logged_by` and `read_at` forward unchanged.
-- `logged_by` and `changed_by` have no foreign key to auth.users for the same
-- reason: the seller deleting their account must not take the buyer's copy with
-- it.
--
-- Grants are per column where a column is a claim about the record rather than
-- the rider's own data, because RLS chooses the row and never the column (the
-- `profiles` argument, CLAUDE.md). Every table revokes from public, anon and
-- authenticated first, because the hosted project still carries Supabase's
-- legacy `grant all` defaults. anon gets nothing.

-- THE BOOK

create table if not exists public.service_books (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null unique references public.vehicles(id) on delete cascade,
  tracks_hours boolean not null default true,
  tracks_distance boolean not null default false,
  distance_unit text not null default 'mi' check (distance_unit in ('mi', 'km')),
  default_session_minutes integer not null default 20 check (default_session_minutes > 0),
  default_session_distance numeric check (default_session_distance >= 0),
  transferred_from_book_id uuid references public.service_books(id) on delete set null,
  transferred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The entry layout a rider adjusts (owner, Q3). A built-in field is one of the
-- entry's own columns and has its shape already, so it carries no field_type; a
-- custom field is the rider's own and must say what it holds.
create table if not exists public.service_book_fields (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.service_books(id) on delete cascade,
  builtin_key text check (builtin_key in ('reading', 'performed_by', 'shop_name', 'cost', 'parts', 'notes', 'attachments')),
  label text not null check (length(btrim(label)) > 0),
  field_type text check (field_type in ('text', 'number', 'money', 'choice', 'date')),
  options jsonb check (options is null or jsonb_typeof(options) = 'array'),
  enabled boolean not null default true,
  required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_book_fields_type_matches_kind
    check ((builtin_key is null) = (field_type is not null)),
  constraint service_book_fields_builtin_once unique (book_id, builtin_key)
);

-- The maintenance items a book tracks. Starter items (lib/service-book/starter-items.ts)
-- ship with no intervals; the rider types them, or a later slice reads them off
-- a photographed manual page. Archived rather than deleted, because entries name
-- them.
create table if not exists public.service_items (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.service_books(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  interval_hours numeric check (interval_hours > 0),
  interval_distance numeric check (interval_distance > 0),
  interval_days integer check (interval_days > 0),
  source text not null default 'typed' check (source in ('starter', 'typed', 'manual_photo')),
  source_attachment_id uuid,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_items_book_idx on public.service_items(book_id);

-- ENTRIES

create table if not exists public.service_entries (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.service_books(id) on delete cascade,
  service_date date not null,
  reading_hours numeric check (reading_hours >= 0),
  reading_distance numeric check (reading_distance >= 0),
  performed_by text check (performed_by in ('self', 'shop')),
  shop_name text,
  cost_cents integer check (cost_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  notes text,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  origin text not null default 'typed' check (origin in ('typed', 'photo_draft')),
  logged_at timestamptz not null default now(),
  logged_by uuid not null,
  revision integer not null default 1,
  deleted_at timestamptz,
  copied_from_entry_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_entries_book_date_idx
  on public.service_entries(book_id, service_date desc);

-- One row per item an entry covers; each is what resets that item's interval.
-- `label` is the item's name as it was when logged, so the history reads the
-- same after a rename, and is the whole item when `item_id` is null (free text).
create table if not exists public.service_entry_items (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.service_entries(id) on delete cascade,
  item_id uuid references public.service_items(id) on delete set null,
  label text not null check (length(btrim(label)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists service_entry_items_entry_idx on public.service_entry_items(entry_id);
create index if not exists service_entry_items_item_idx on public.service_entry_items(item_id);

create table if not exists public.service_entry_parts (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.service_entries(id) on delete cascade,
  entry_item_id uuid references public.service_entry_items(id) on delete set null,
  brand text,
  part_number text,
  quantity numeric check (quantity > 0),
  unit_cost_cents integer check (unit_cost_cents >= 0),
  created_at timestamptz not null default now()
);

create index if not exists service_entry_parts_entry_idx on public.service_entry_parts(entry_id);

-- Append-only. `snapshot` is the entry row with its items and parts as they
-- stood after the change. `transaction_id` is what folds every write of one
-- transaction into one revision.
create table if not exists public.service_entry_revisions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.service_entries(id) on delete cascade,
  revision integer not null,
  kind text not null check (kind in ('created', 'edited', 'deleted', 'restored', 'transferred')),
  snapshot jsonb not null,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  transaction_id bigint not null,
  constraint service_entry_revisions_once unique (entry_id, revision)
);

-- READINGS

create table if not exists public.vehicle_readings (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.service_books(id) on delete cascade,
  reading_date date not null,
  read_at timestamptz not null default now(),
  hours numeric check (hours >= 0),
  distance numeric check (distance >= 0),
  source text not null default 'rider' check (source in ('rider', 'entry', 'transfer')),
  entry_id uuid unique references public.service_entries(id) on delete cascade,
  supersedes_id uuid unique references public.vehicle_readings(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_readings_has_a_value check (hours is not null or distance is not null),
  constraint vehicle_readings_entry_matches_source check ((source = 'entry') = (entry_id is not null))
);

create index if not exists vehicle_readings_book_date_idx
  on public.vehicle_readings(book_id, reading_date desc);

-- OWNERSHIP

create or replace function public.service_book_owned(p_book_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.service_books b
      join public.vehicles v on v.id = b.vehicle_id
     where b.id = p_book_id
       and v.user_id = auth.uid()
  );
$$;

create or replace function public.service_entry_owned(p_entry_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.service_entries e
     where e.id = p_entry_id
       and public.service_book_owned(e.book_id)
  );
$$;

revoke all on function public.service_book_owned(uuid) from public, anon, authenticated;
grant execute on function public.service_book_owned(uuid) to authenticated, service_role;
revoke all on function public.service_entry_owned(uuid) from public, anon, authenticated;
grant execute on function public.service_entry_owned(uuid) to authenticated, service_role;

-- THE PINS
--
-- On insert from a Data API role, the clock and the rider are the server's. On
-- every update, by anyone, what says who logged the entry, when, into which
-- book and from where cannot change, and the revision counter moves once per
-- transaction. security invoker on purpose: `current_user` is what tells a
-- rider's write from the owner-run transfer copy, and a definer function would
-- always read its owner.
create or replace function public.service_entries_pin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated', 'service_role') then
      new.logged_at := now();
      new.logged_by := coalesce(auth.uid(), new.logged_by);
      new.copied_from_entry_id := null;
      if new.deleted_at is not null then
        new.deleted_at := now();
      end if;
    end if;
    new.revision := 1;
    return new;
  end if;

  new.book_id := old.book_id;
  new.logged_at := old.logged_at;
  new.logged_by := old.logged_by;
  new.origin := old.origin;
  new.copied_from_entry_id := old.copied_from_entry_id;
  new.created_at := old.created_at;
  if new.deleted_at is distinct from old.deleted_at and new.deleted_at is not null then
    new.deleted_at := now();
  end if;

  if exists (
    select 1
      from public.service_entry_revisions r
     where r.entry_id = old.id
       and r.transaction_id = txid_current()
  ) then
    new.revision := old.revision;
  else
    new.revision := old.revision + 1;
  end if;

  return new;
end;
$$;

create or replace trigger service_entries_pin
  before insert or update on public.service_entries
  for each row execute function public.service_entries_pin();

create or replace trigger service_entries_set_updated_at
  before update on public.service_entries
  for each row execute function public.set_updated_at();

create or replace function public.vehicle_readings_pin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated', 'service_role') then
      new.read_at := now();
    end if;
    return new;
  end if;

  new.book_id := old.book_id;
  new.read_at := old.read_at;
  new.source := old.source;
  new.entry_id := old.entry_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

create or replace trigger vehicle_readings_pin
  before insert or update on public.vehicle_readings
  for each row execute function public.vehicle_readings_pin();

create or replace trigger vehicle_readings_set_updated_at
  before update on public.vehicle_readings
  for each row execute function public.set_updated_at();

create or replace trigger service_books_set_updated_at
  before update on public.service_books
  for each row execute function public.set_updated_at();

create or replace trigger service_book_fields_set_updated_at
  before update on public.service_book_fields
  for each row execute function public.set_updated_at();

create or replace trigger service_items_set_updated_at
  before update on public.service_items
  for each row execute function public.set_updated_at();

-- THE EDIT HISTORY
--
-- After every insert or update of an entry, its snapshot is written as the
-- entry's current revision: a new row for the first write of a transaction, the
-- same row refreshed for every later one, so the revision holds the state the
-- transaction committed. A transaction that created the entry stays `created`.
-- Its kind is the transaction's net change, read against the revision before it
-- rather than the row event: a delete followed by an item edit is `deleted`, and
-- a delete undone in the same transaction is `edited`.
--
-- security definer because it writes a table no API role may write. It cannot
-- be called directly - it returns `trigger` - but the execute decision is
-- written down here as for every security definer function.
create or replace function public.record_service_entry_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_was_deleted boolean;
  v_snapshot jsonb;
begin
  if tg_op = 'INSERT' then
    v_kind := 'created';
  else
    select r.snapshot ->> 'deleted_at' is not null
      into v_was_deleted
      from public.service_entry_revisions r
     where r.entry_id = new.id
       and r.transaction_id <> txid_current()
     order by r.revision desc
     limit 1;

    if not v_was_deleted and new.deleted_at is not null then
      v_kind := 'deleted';
    elsif v_was_deleted and new.deleted_at is null then
      v_kind := 'restored';
    else
      v_kind := 'edited';
    end if;
  end if;

  v_snapshot := (to_jsonb(new) - 'revision' - 'updated_at') || jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'item_id', i.item_id, 'label', i.label)
                       order by i.created_at, i.id)
        from public.service_entry_items i
       where i.entry_id = new.id
    ), '[]'::jsonb),
    'parts', coalesce((
      select jsonb_agg(jsonb_build_object(
                         'id', p.id, 'entry_item_id', p.entry_item_id, 'brand', p.brand,
                         'part_number', p.part_number, 'quantity', p.quantity,
                         'unit_cost_cents', p.unit_cost_cents)
                       order by p.created_at, p.id)
        from public.service_entry_parts p
       where p.entry_id = new.id
    ), '[]'::jsonb)
  );

  update public.service_entry_revisions r
     set snapshot = v_snapshot,
         kind = case when r.kind = 'created' then r.kind else v_kind end
   where r.entry_id = new.id
     and r.transaction_id = txid_current();

  if not found then
    insert into public.service_entry_revisions (entry_id, revision, kind, snapshot, changed_by, transaction_id)
    values (new.id, new.revision, v_kind, v_snapshot, auth.uid(), txid_current());
  end if;

  return null;
end;
$$;

revoke all on function public.record_service_entry_revision() from public, anon, authenticated;

create or replace trigger service_entries_record_revision
  after insert or update on public.service_entries
  for each row execute function public.record_service_entry_revision();

-- A change to an entry's items or parts is a change to the entry: touching the
-- entry row sends it through the pin and the history above, so there is one
-- path that writes a revision. security definer because the rider holds no
-- update on `updated_at`; the row it touches is one the rider's own write on the
-- child already had to own. When the entry itself is going (its vehicle's
-- cascade), the update finds no row and writes nothing.
create or replace function public.touch_service_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.service_entries set updated_at = now() where id = old.entry_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.entry_id is distinct from old.entry_id) then
    update public.service_entries set updated_at = now() where id = new.entry_id;
  end if;
  return null;
end;
$$;

revoke all on function public.touch_service_entry() from public, anon, authenticated;

create or replace trigger service_entry_items_touch_entry
  after insert or update or delete on public.service_entry_items
  for each row execute function public.touch_service_entry();

create or replace trigger service_entry_parts_touch_entry
  after insert or update or delete on public.service_entry_parts
  for each row execute function public.touch_service_entry();

-- An entry's reading is a reading. It follows the entry: written with it,
-- changed with it, and gone while the entry is removed or carries no reading,
-- so a soft-deleted entry stops counting as the truth about the bike's usage.
-- security definer because a rider may not write `source = 'entry'` rows.
create or replace function public.sync_service_entry_reading()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null or (new.reading_hours is null and new.reading_distance is null) then
    delete from public.vehicle_readings where entry_id = new.id;
    return null;
  end if;

  insert into public.vehicle_readings (book_id, reading_date, read_at, hours, distance, source, entry_id)
  values (new.book_id, new.service_date, new.logged_at, new.reading_hours, new.reading_distance, 'entry', new.id)
  on conflict (entry_id) do update
    set reading_date = excluded.reading_date,
        hours = excluded.hours,
        distance = excluded.distance;

  return null;
end;
$$;

revoke all on function public.sync_service_entry_reading() from public, anon, authenticated;

create or replace trigger service_entries_sync_reading
  after insert or update on public.service_entries
  for each row execute function public.sync_service_entry_reading();

-- ROW LEVEL SECURITY

alter table public.service_books enable row level security;
alter table public.service_book_fields enable row level security;
alter table public.service_items enable row level security;
alter table public.service_entries enable row level security;
alter table public.service_entry_items enable row level security;
alter table public.service_entry_parts enable row level security;
alter table public.service_entry_revisions enable row level security;
alter table public.vehicle_readings enable row level security;

-- The book's own policies read the vehicle directly: `service_book_owned`
-- reads this table, so using it here would recurse.
create policy "service_books: select own"
  on public.service_books for select
  using (exists (select 1 from public.vehicles v where v.id = service_books.vehicle_id and v.user_id = auth.uid()));

create policy "service_books: insert own"
  on public.service_books for insert
  with check (exists (select 1 from public.vehicles v where v.id = service_books.vehicle_id and v.user_id = auth.uid()));

create policy "service_books: update own"
  on public.service_books for update
  using (exists (select 1 from public.vehicles v where v.id = service_books.vehicle_id and v.user_id = auth.uid()))
  with check (exists (select 1 from public.vehicles v where v.id = service_books.vehicle_id and v.user_id = auth.uid()));

create policy "service_book_fields: select own"
  on public.service_book_fields for select
  using (public.service_book_owned(book_id));

create policy "service_book_fields: insert own"
  on public.service_book_fields for insert
  with check (public.service_book_owned(book_id));

create policy "service_book_fields: update own"
  on public.service_book_fields for update
  using (public.service_book_owned(book_id))
  with check (public.service_book_owned(book_id));

create policy "service_items: select own"
  on public.service_items for select
  using (public.service_book_owned(book_id));

create policy "service_items: insert own"
  on public.service_items for insert
  with check (public.service_book_owned(book_id));

create policy "service_items: update own"
  on public.service_items for update
  using (public.service_book_owned(book_id))
  with check (public.service_book_owned(book_id));

create policy "service_entries: select own"
  on public.service_entries for select
  using (public.service_book_owned(book_id));

create policy "service_entries: insert own"
  on public.service_entries for insert
  with check (public.service_book_owned(book_id));

create policy "service_entries: update own"
  on public.service_entries for update
  using (public.service_book_owned(book_id))
  with check (public.service_book_owned(book_id));

-- An entry's item must be one of the same book's items, or an entry could
-- reset another bike's interval.
create policy "service_entry_items: select own"
  on public.service_entry_items for select
  using (public.service_entry_owned(entry_id));

create policy "service_entry_items: insert own"
  on public.service_entry_items for insert
  with check (
    public.service_entry_owned(entry_id)
    and (service_entry_items.item_id is null or exists (
      select 1
        from public.service_items i
        join public.service_entries e on e.book_id = i.book_id
       where i.id = service_entry_items.item_id
         and e.id = service_entry_items.entry_id
    ))
  );

create policy "service_entry_items: update own"
  on public.service_entry_items for update
  using (public.service_entry_owned(entry_id))
  with check (
    public.service_entry_owned(entry_id)
    and (service_entry_items.item_id is null or exists (
      select 1
        from public.service_items i
        join public.service_entries e on e.book_id = i.book_id
       where i.id = service_entry_items.item_id
         and e.id = service_entry_items.entry_id
    ))
  );

create policy "service_entry_items: delete own"
  on public.service_entry_items for delete
  using (public.service_entry_owned(entry_id));

create policy "service_entry_parts: select own"
  on public.service_entry_parts for select
  using (public.service_entry_owned(entry_id));

create policy "service_entry_parts: insert own"
  on public.service_entry_parts for insert
  with check (
    public.service_entry_owned(entry_id)
    and (service_entry_parts.entry_item_id is null or exists (
      select 1
        from public.service_entry_items i
       where i.id = service_entry_parts.entry_item_id
         and i.entry_id = service_entry_parts.entry_id
    ))
  );

create policy "service_entry_parts: update own"
  on public.service_entry_parts for update
  using (public.service_entry_owned(entry_id))
  with check (
    public.service_entry_owned(entry_id)
    and (service_entry_parts.entry_item_id is null or exists (
      select 1
        from public.service_entry_items i
       where i.id = service_entry_parts.entry_item_id
         and i.entry_id = service_entry_parts.entry_id
    ))
  );

create policy "service_entry_parts: delete own"
  on public.service_entry_parts for delete
  using (public.service_entry_owned(entry_id));

create policy "service_entry_revisions: select own"
  on public.service_entry_revisions for select
  using (public.service_entry_owned(entry_id));

create policy "vehicle_readings: select own"
  on public.vehicle_readings for select
  using (public.service_book_owned(book_id));

-- A correction supersedes one of the same book's rider readings. A reading an
-- entry wrote is corrected by editing the entry.
create policy "vehicle_readings: insert own"
  on public.vehicle_readings for insert
  with check (
    public.service_book_owned(book_id)
    and (vehicle_readings.supersedes_id is null or exists (
      select 1
        from public.vehicle_readings r
       where r.id = vehicle_readings.supersedes_id
         and r.book_id = vehicle_readings.book_id
         and r.source = 'rider'
    ))
  );

-- GRANTS
--
-- No delete on entries or readings for any API role, and no update on a
-- reading: a rider corrects one by superseding it. Items and parts of an
-- entry may be removed while editing it, because the revision written by that
-- edit keeps what they were. No grant reaches the provenance columns: a book's
-- transfer origin, an entry's `logged_at`, `logged_by`, `revision` and copy
-- origin, a reading's `read_at`, `source` and `entry_id`.
revoke all on public.service_books from public, anon, authenticated;
grant select on public.service_books to authenticated;
grant insert (id, vehicle_id, tracks_hours, tracks_distance, distance_unit, default_session_minutes, default_session_distance)
  on public.service_books to authenticated;
grant update (tracks_hours, tracks_distance, distance_unit, default_session_minutes, default_session_distance)
  on public.service_books to authenticated;

revoke all on public.service_book_fields from public, anon, authenticated;
grant select on public.service_book_fields to authenticated;
grant insert (id, book_id, builtin_key, label, field_type, options, enabled, required, sort_order)
  on public.service_book_fields to authenticated;
grant update (label, options, enabled, required, sort_order)
  on public.service_book_fields to authenticated;

revoke all on public.service_items from public, anon, authenticated;
grant select on public.service_items to authenticated;
grant insert (id, book_id, name, interval_hours, interval_distance, interval_days, source, sort_order, archived_at)
  on public.service_items to authenticated;
grant update (name, interval_hours, interval_distance, interval_days, sort_order, archived_at)
  on public.service_items to authenticated;

revoke all on public.service_entries from public, anon, authenticated;
grant select on public.service_entries to authenticated;
grant insert (id, book_id, service_date, reading_hours, reading_distance, performed_by, shop_name, cost_cents, currency, notes, custom_fields, origin)
  on public.service_entries to authenticated;
grant update (service_date, reading_hours, reading_distance, performed_by, shop_name, cost_cents, currency, notes, custom_fields, deleted_at)
  on public.service_entries to authenticated;

revoke all on public.service_entry_items from public, anon, authenticated;
grant select, delete on public.service_entry_items to authenticated;
grant insert (id, entry_id, item_id, label) on public.service_entry_items to authenticated;
grant update (item_id, label) on public.service_entry_items to authenticated;

revoke all on public.service_entry_parts from public, anon, authenticated;
grant select, delete on public.service_entry_parts to authenticated;
grant insert (id, entry_id, entry_item_id, brand, part_number, quantity, unit_cost_cents)
  on public.service_entry_parts to authenticated;
grant update (entry_item_id, brand, part_number, quantity, unit_cost_cents)
  on public.service_entry_parts to authenticated;

revoke all on public.vehicle_readings from public, anon, authenticated;
grant select on public.vehicle_readings to authenticated;
grant insert (id, book_id, reading_date, hours, distance, supersedes_id) on public.vehicle_readings to authenticated;

-- The history and the entries it describes are closed to the service role too,
-- which otherwise holds everything through the default privileges
-- (20260719001100). The triggers write the history as the owner, and a
-- vehicle's cascade deletes as the owner, so neither needs these.
revoke all on public.service_entry_revisions from public, anon, authenticated, service_role;
grant select on public.service_entry_revisions to authenticated, service_role;
revoke delete, truncate on public.service_entries from service_role;

-- Where the rider overrides the service book's suggestions (owner, 2026-10-08):
-- "Sometimes doing a day at a smaller track won't warrant an oil change but a
-- big day somewhere like cota would. But allow the user to make that decision."
--
-- Usage estimated from logged sessions and the due state worked out from it are
-- suggestions. Two tables hold the rider's word on them; the rules that read
-- these are application code in a later change, and nothing here computes a due
-- date.
--
-- `session_usage_weights`: how much one logged session counts toward a book's
-- usage estimate. Weight 0 is "this day does not count", 2 is a big day; the
-- minutes and distance overrides replace the estimate for that session outright.
-- The session must be on the book's own vehicle, so a weight cannot count a
-- session from another bike, or another rider, toward this one.
--
-- `service_due_overrides`: a snooze, a skipped cycle, or a next-due the rider
-- set by hand, per item. The newest per item wins, which is why `created_at` is
-- the server's: a row dated ahead would win for good.

create table if not exists public.session_usage_weights (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.service_books(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  weight numeric not null default 1 check (weight >= 0 and weight <= 3),
  minutes_override integer check (minutes_override >= 0),
  distance_override numeric check (distance_override >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_usage_weights_once unique (book_id, session_id)
);

create index if not exists session_usage_weights_session_idx
  on public.session_usage_weights(session_id);

create or replace trigger session_usage_weights_set_updated_at
  before update on public.session_usage_weights
  for each row execute function public.set_updated_at();

create table if not exists public.service_due_overrides (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.service_books(id) on delete cascade,
  item_id uuid not null references public.service_items(id) on delete cascade,
  kind text not null check (kind in ('snooze', 'skip_cycle', 'set_next_due')),
  until_date date,
  until_hours numeric check (until_hours >= 0),
  until_distance numeric check (until_distance >= 0),
  anchor_hours numeric check (anchor_hours >= 0),
  anchor_distance numeric check (anchor_distance >= 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists service_due_overrides_item_created_idx
  on public.service_due_overrides(item_id, created_at desc);

alter table public.session_usage_weights enable row level security;
alter table public.service_due_overrides enable row level security;

create policy "session_usage_weights: select own"
  on public.session_usage_weights for select
  using (public.service_book_owned(book_id));

create policy "session_usage_weights: insert own"
  on public.session_usage_weights for insert
  with check (
    public.service_book_owned(book_id)
    and exists (
      select 1
        from public.sessions s
        join public.service_books b on b.vehicle_id = s.vehicle_id
       where s.id = session_usage_weights.session_id
         and b.id = session_usage_weights.book_id
         and s.user_id = auth.uid()
    )
  );

create policy "session_usage_weights: update own"
  on public.session_usage_weights for update
  using (public.service_book_owned(book_id));

create policy "session_usage_weights: delete own"
  on public.session_usage_weights for delete
  using (public.service_book_owned(book_id));

create policy "service_due_overrides: select own"
  on public.service_due_overrides for select
  using (public.service_book_owned(book_id));

-- The item must be one of the same book's, or an override could quiet another
-- bike's reminder.
create policy "service_due_overrides: insert own"
  on public.service_due_overrides for insert
  with check (
    public.service_book_owned(book_id)
    and exists (
      select 1
        from public.service_items i
       where i.id = service_due_overrides.item_id
         and i.book_id = service_due_overrides.book_id
    )
  );

create policy "service_due_overrides: update own"
  on public.service_due_overrides for update
  using (public.service_book_owned(book_id));

-- The book and session a weight names, and the book and item an override names,
-- are fixed once written: a correction is a new row, so neither column is in an
-- update grant. Withdrawing a weight is deleting it; an override is superseded
-- by a newer one rather than removed.
revoke all on public.session_usage_weights from public, anon, authenticated;
grant select, delete on public.session_usage_weights to authenticated;
grant insert (id, book_id, session_id, weight, minutes_override, distance_override, note)
  on public.session_usage_weights to authenticated;
grant update (weight, minutes_override, distance_override, note)
  on public.session_usage_weights to authenticated;

revoke all on public.service_due_overrides from public, anon, authenticated;
grant select on public.service_due_overrides to authenticated;
grant insert (id, book_id, item_id, kind, until_date, until_hours, until_distance, anchor_hours, anchor_distance, note)
  on public.service_due_overrides to authenticated;
grant update (until_date, until_hours, until_distance, anchor_hours, anchor_distance, note)
  on public.service_due_overrides to authenticated;
commit;
```

**3. Verify.**

```sql
-- hosted-service-book-verify
with service_tables(name) as (
  values
    ('service_books'),
    ('service_book_fields'),
    ('service_items'),
    ('service_entries'),
    ('service_entry_items'),
    ('service_entry_parts'),
    ('service_entry_revisions'),
    ('vehicle_readings'),
    ('session_usage_weights'),
    ('service_due_overrides')
)
select
  (select count(*) from service_tables t
     join pg_class c on c.oid = to_regclass('public.' || t.name)
    where c.relrowsecurity) as tables_with_rls,
  (select count(*) from service_tables t
    where has_any_column_privilege('anon', 'public.' || t.name, 'select, insert, update')
       or has_table_privilege('anon', 'public.' || t.name, 'delete')) as anon_tables,
  (select count(*) from pg_policies p
     join service_tables t on t.name = p.tablename
    where p.schemaname = 'public') as policies,
  has_table_privilege('authenticated', 'public.service_entries', 'delete') as rider_can_delete_entries,
  has_table_privilege('service_role', 'public.service_entries', 'delete') as service_can_delete_entries,
  has_any_column_privilege('authenticated', 'public.service_entry_revisions', 'insert, update')
    or has_table_privilege('authenticated', 'public.service_entry_revisions', 'delete') as rider_can_write_history,
  has_any_column_privilege('service_role', 'public.service_entry_revisions', 'insert, update')
    or has_table_privilege('service_role', 'public.service_entry_revisions', 'delete') as service_can_write_history,
  has_column_privilege('authenticated', 'public.service_entries', 'logged_at', 'insert, update') as rider_can_set_logged_at,
  has_any_column_privilege('authenticated', 'public.vehicle_readings', 'update')
    or has_table_privilege('authenticated', 'public.vehicle_readings', 'delete') as rider_can_change_readings,
  has_function_privilege('anon', 'public.service_book_owned(uuid)', 'execute') as anon_can_call_owned,
  (select count(*) from pg_proc p
    where p.oid in (
      to_regprocedure('public.service_entries_pin()'),
      to_regprocedure('public.record_service_entry_revision()'),
      to_regprocedure('public.touch_service_entry()'),
      to_regprocedure('public.sync_service_entry_reading()')
    )
      and md5(p.prosrc) in (
        'de6aef12682d036a68e1c4a7ebeac5fe',
        '5ace45cb78572b449f7ec7078e61939a',
        'db3a88e2ea61179ccaefa5bed2007b11',
        'a054c4eeadd645b5206f678f2528796d'
      )) as trigger_bodies_match;
```

Expect `10`, `0`, `30`, then seven `false`, then `4`.

`policies` counts every policy on the ten tables, so a policy added by hand
beside the migration's reads above `30`. `trigger_bodies_match` reads below `4`
when a trigger function is not byte for byte the migration's: run the apply
block's `create or replace function` statements again rather than editing in
place. Rows 29 and 30 of `scripts/sql/audit-migrations-against-database.sql`
then read `present`.

**4. Rollback.** Drops every table and function above, **with every book,
entry and revision in them**, so this is for before any rider has written one.

```sql
-- hosted-service-book-rollback
begin;
drop table if exists public.service_due_overrides;
drop table if exists public.session_usage_weights;
drop table if exists public.vehicle_readings;
drop table if exists public.service_entry_revisions;
drop table if exists public.service_entry_parts;
drop table if exists public.service_entry_items;
drop table if exists public.service_entries;
drop table if exists public.service_items;
drop table if exists public.service_book_fields;
drop table if exists public.service_books;
drop function if exists public.sync_service_entry_reading();
drop function if exists public.touch_service_entry();
drop function if exists public.record_service_entry_revision();
drop function if exists public.vehicle_readings_pin();
drop function if exists public.service_entries_pin();
drop function if exists public.service_entry_owned(uuid);
drop function if exists public.service_book_owned(uuid);
commit;
```

## Invite a Rider

```bash
npm run beta:invite -- create rider@example.com
```

The command prints the plaintext code once. Send it only to the matching email
owner. Optional flags set invite validity and cohort:

```bash
npm run beta:invite -- create rider@example.com --days 7 --cohort motorcycle-founding
```

Every accepted rider receives all Pro capabilities for 90 days from redemption,
without a Stripe subscription.

## Weekly Founder Review

```bash
npm run beta:report
```

Review the quantitative report alongside rider interviews. At minimum, inspect:

- accepted riders who log sessions on two distinct track dates;
- comparison views followed by saved outcomes;
- AI recommendations linked to later outcomes;
- comparison and AI usefulness scores;
- the percentage who would be very disappointed if the product disappeared;
- capture duration and safety or trust concerns from interviews.

## Decision Gate

Run the formal review when twelve riders have accepted and eight have logged two
distinct track dates, or after 90 days—whichever comes first.

- Continue and deepen motorcycle workflows when repeat use, usefulness, and trust
  clear the gate.
- Narrow the loop when riders log but do not compare or record outcomes.
- Rework guidance when comparisons are useful but AI scores or trust are weak.
- Test car positioning only after the motorcycle loop demonstrates repeat value.
