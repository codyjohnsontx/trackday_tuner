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
   database already predates this work, those five are what is left to apply,
   and after `20260816001200` run the audit below. Migrations build the schema
   and nothing else: the repository does not provision the `vehicle-photos`
   storage bucket, so on a deployment standing up its own database, adding a
   vehicle with a photo fails with "Bucket not found" until that bucket is
   created out of band.
2. Set `BETA_INVITE_ONLY=true`, a long random `BETA_INVITE_SECRET`, and a distinct
   `BETA_FORM_RATE_LIMIT_SECRET` in the deployment environment.
3. Deploy and verify the public home page, waitlist, invitation signup, session
   capture, comparison, and outcome flows.
4. Recruit twelve motorcycle track-day riders who expect at least two track dates
   in the next 90 days.

Never change `BETA_INVITE_SECRET` while active invitations exist; invitation hashes
cannot be recovered after rotation.

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
