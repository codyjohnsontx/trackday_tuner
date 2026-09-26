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
   Migrations build the schema and the storage policies, not the storage bucket:
   the CLI provisions buckets from `[storage.buckets.*]` in `supabase/config.toml`,
   so on a deployment standing up its own project, `npx supabase seed buckets
   --linked` once after `supabase link` is what creates `vehicle-photos`. Without
   it, adding a vehicle with a photo fails with "Photo upload failed: Bucket not
   found". See "Local Run" in README.md.
   `20260901001400` and `20260903001500` are the migrations in that list carrying
   a **deploy-ordering requirement**: each changes the signature of
   `replace_session_laps`, so apply them *before* the release that calls it goes
   live. Migrations here are applied by hand while Vercel deploys on merge, so on
   an existing deployment that means applying them before merging the pull
   request that ships the matching caller. Either order leaves a window and both
   were walked in a browser: the mismatched call gets `PGRST202` from PostgREST,
   nothing is saved and nothing stored is lost. The rider no longer reads that
   `PGRST202`: `lib/sessions/create.ts` passes through only the function's own
   domain rejections and answers everything else with a sentence saying the save
   did not happen, sending the real error to `reportError`. So the window is
   quiet on screen, and what names it is the deployment's own `/api/health` -
   its `schema_contract` check resolves `replace_session_laps` by parameter name
   and fails on exactly this drift (see `docs/monitoring.md`).
   Saving laps *and* logging a session are both down for that window -
   `createSession` calls the function even for a session with no laps - while
   reading is unaffected. Each migration's own header carries the detail.
   `20260924001700` (retained AI question text and its 90-day purge) also goes
   in by hand on a project with no migration history, and also before the
   release that ships it - see "Apply the AI question-text table by hand" below.
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
