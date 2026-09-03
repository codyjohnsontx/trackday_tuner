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
   the message reaches the rider, nothing is saved and nothing stored is lost.
   Saving laps *and* logging a session are both down for that window -
   `createSession` calls the function even for a session with no laps - while
   reading is unaffected. Each migration's own header carries the detail.
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
