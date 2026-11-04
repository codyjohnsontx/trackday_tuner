---
name: trackday-session-write
description: "Use when changing trackday_tuner web or mobile session creation, validation, idempotency, caps, CORS, or atomic writes."
---

## The Session Write Path

A session has one writer, `createSessionForUser` (`lib/sessions/create.ts`), and
one write, `create_session_with_laps`. The website form's server action calls it
with an id it mints per save (`randomUUID()`); `POST /api/mobile/sessions` (owner
decision D1) calls it with the id the phone minted, behind `authenticateBearer`
(`lib/supabase/bearer.ts`): the anon key plus the rider's own access token, so
RLS applies exactly as with cookies, and never the service role. Four things are
load-bearing:

- **The status is the phone's retry decision.** 400, 402 and 409 are the rider's
  to fix and the sync engine parks them; 401 means signed out; 503 is ours and is
  retried. So an unreachable GoTrue or a failed profile read is 503, never 401 or
  a plan refusal - either would strand a rider's outbox. `CreateSessionFailureKind`
  in `lib/sessions/create.ts` is where a new refusal gets its class.
- **Idempotent on the body's `id`**, which reaches `createSessionForUser` as
  `options.id` and never inside `CreateSessionInput`, so the website's form cannot
  choose a primary key. "Already handled" is a row with that id OR a
  `deleted_sessions` record of one (20260928002300, written by a trigger on every
  session delete), so a retry whose first answer was lost cannot recreate a
  session the rider deleted since; that answers 200 with `replayed: true`,
  `deleted: true` and `session: null`, which tells the phone the save was handled
  and the rider has since deleted that session, so it clears the outbox entry and
  removes its local copy. **The free-plan session cap exists once**, inside
  `create_session_with_laps` under a per-rider advisory lock, after the replay
  checks, mirroring `resolveUserAccess` in SQL - so a form save and a phone save
  at a free rider's last slot cannot both pass (the form's old TypeScript count
  let them reach eleven). `lib/plans.ts` is only the number the app prints;
  `tests/db/create-session-with-laps.spec.ts` pins the SQL to it and to
  `resolveUserAccess` for every entitlement case. 20260928002300's header still
  says the form counts in the application and names a structural test of the two
  copies; both were true until the form moved onto the function, and an applied
  migration is not edited.
- **Atomic.** The row, laps and environment are one call to
  `create_session_with_laps` (20260927002200), so a failure stores nothing and a
  stored session is always complete - which is what lets a replay write nothing
  and answer 200 without looking. Only a track row the save created sits outside
  it, and on any refusal the database answered with a code the save takes it
  back through `delete_auto_created_track_if_unused` (20260930002400), never a
  plain delete: another save can find that track by name and store its session
  against it before the refusal lands, and a delete then unlinks the winner
  (`on delete set null`). The function locks the row and deletes only while no
  session references it - ANY rider's, through the `security definer` check
  `auto_created_track_is_referenced` (20261001002500), because a rider's custom
  track is private but the foreign key lets another rider's session point at it.
  That check answers only for the caller's own auto-created track (null for any
  other), so it is not a lookup into other riders' data; the take-back itself
  stays `security invoker`. Both are hand-applied ("Take back a refused save's
  track safely, by hand", then "Let the track take-back see every rider's
  sessions, by hand"), and without them the take-back fails, is reported, and
  leaves a stray track. **The website form now depends on the function too**, so
  a hosted project without it cannot save a session from either client: it is
  applied by hand ("Apply the session create function by hand" in
  `docs/beta-runbook.md`, then "Close session ownership, deleted-session replays
  and the free-plan race by hand"), and `/api/health`'s `schema_contract` names
  it. A session's vehicle must be the rider's on every path: the `sessions`
  insert and update policies check it, and the function raises `TT404` first,
  which both clients read as the garage sentence.
- **The body is validated leaf by leaf** (`lib/sessions/parse-create-request.ts`)
  because the setup blobs are unconstrained `jsonb`, so the phone stores the shape
  the form does; which keys a blob may hold is read off `SETUP_FIELDS`, and the
  screens no longer depend on it (`lib/stored-session.ts`).

`tests/db/create-session.spec.ts` is where this path's behaviour is proven, as
both clients call it, against a real database; `lib/actions/sessions.test.ts`
keeps only the faults a database cannot produce on cue.

CORS allows only `MOBILE_APP_ORIGINS`; the native app sends no `Origin`.

