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
   foundation), then `20260719001100` (the Data API grants), and finally
   `20260816001200`, which is not beta-specific but installs the trigger that
   gives every signup path a `profiles` row - without it a rider who did not
   arrive through the invite route can never subscribe. On a deployment whose
   database already predates this work, those five are what is left to apply;
   run the check below before `20260816001200` and the audit below after it.
   Migrations build the schema and the storage policies, not the storage bucket:
   the CLI provisions buckets from `[storage.buckets.*]` in `supabase/config.toml`,
   so on a deployment standing up its own project, `npx supabase seed buckets
   --linked` once after `supabase link` is what creates `vehicle-photos`. Without
   it, adding a vehicle with a photo fails with "Photo upload failed: Bucket not
   found". See "Local Run" in README.md.
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
