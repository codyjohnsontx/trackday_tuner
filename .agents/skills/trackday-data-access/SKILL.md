---
name: trackday-data-access
description: "Use when changing trackday_tuner Supabase clients, session reads and ordering, dashboard session selection, or read-before-write behavior."
---

## Supabase Notes

- Use `lib/supabase/server.ts` in Server Components and Route Handlers
- Use `lib/supabase/client.ts` in Client Components
- `lib/supabase/middleware.ts` handles session refresh - runs via `proxy.ts`
  (Next 16's name for `middleware.ts`; a proxy always runs on the Node.js runtime)
- Admin client (`lib/supabase/admin.ts`) uses service role key — server only
- `sessions.start_time` is nullable, and PostgREST filters inherit SQL NULL
  semantics, so `start_time.lt.<t>` silently drops every row that has none. Session
  ordering is defined once, in `isSessionBefore` / `compareSessionsDesc`
  (`lib/session-compare.ts`), which coalesce a missing start time to `00:00:00` and
  fall back to `created_at`. Reach for `fetchPreviousSession`
  (`lib/session-previous.ts`) rather than writing a fourth predicate: three call
  sites once hand-rolled the raw filter and all three went blind to same-day
  sessions logged without a start time
- The same rule governs **list ordering**, and a track day is the case that exposes
  it: every session shares a `date`, so `.order('date')` alone leaves the whole day
  tied and the tie broken by whatever the planner emits. Any query selecting whole
  session rows orders `date`, then `start_time` with `nullsFirst: false`, then
  `created_at` - the SQL mirror of `compareSessionsDesc`. `getSessions` once ordered
  on `date` alone, which listed a rider's day backwards and left the session they had
  just finished off the dashboard's three-row "Recent" list. It is invisible in demo
  mode, where `getDemoSessions` sorts in TypeScript with the shared comparator, so
  this class of bug needs a real account to see.
  `tests/unit/session-list-ordering.test.ts` guards it
- **A per-vehicle fact has to come from that vehicle's own sessions.** `getVehicles`
  orders `created_at` ascending, so `vehicles[0]` is the *oldest* vehicle. The
  dashboard hero paired that nickname with the newest session of *any* vehicle, so a
  rider with a second bike read their new bike's track day under their old bike's
  name. `resolveDashboardHeroSubject` (`lib/dashboard-hero.ts`) returns the name and
  the session together so the two cannot be picked off different lists.
  `lib/dashboard-hero.test.ts` guards it
- **A read whose answer decides a destructive write has to report its failure.**
  `getSessionLaps` discarded its Supabase error, so a failed select and a session
  with no laps were the same `[]`. The panel read that as "no laps yet" and offered
  "Add Lap Times" on a session holding four; the rider retyping what they
  remembered called `replace_session_laps`, which deletes the whole set before
  inserting, so their own recovery was what lost the times. It returns
  `ActionResult<SessionLap[]>` now and `SessionLapsPanel` takes `null` for a failed
  read - it offers nothing that saves until the read succeeds, because a rider
  cannot be told about this by a server log. That is what closes the defect. The
  database adds a backstop for callers not yet written: `replace_session_laps`
  takes `p_expected_laps` - the set the caller read, echoed back - raises SQLSTATE
  `TT409` unless the stored laps ARE that set, and has no weaker signature left
  (20260903001500). **A LAP SET'S IDENTITY IS ITS CONTENT, DERIVED NOT STORED.**
  `session_laps_identity` is the only definition of it, and both sides of the
  comparison go through that one function so they cannot drift apart. It is read
  off the rows on every call rather than kept in a stamp column, because
  `authenticated` writes `session_laps` directly, so a stamp would say
  "unchanged" while the laps had moved; and because a derived identity needs no
  backfill and no null-tolerant compare. The caller echoes the rows rather than a
  digest it folded itself - a fold in TypeScript and a fold in SQL are two records
  of one fact. `source` is excluded on purpose: the editor cannot see it, so
  including it would refuse every save against imported laps forever, and a guard
  that refuses honest saves is worse than the gap it closes. The identity reads
  `session_laps` alone, so the `telemetry_summaries` upsert on this same path
  cannot make the next save look stale. Two tabs that both read 12 laps, one
  editing a lap time or an `included` flag and saving first, are now told apart
  and the second is refused. **20260901001400's header describes the weaker count
  guard it shipped and is not edited, because an applied migration never is - its
  "no comment promises more than the count comparison" is superseded by
  20260903001500 and by this bullet.** What is still not caught is two saves
  carrying the SAME laps, because nothing is lost when they are. The session
  delete confirmation is the same case: `getSessionEnvironment`,
  `getSessionOutcome` and `getSessionChangeRecords` return `ActionResult` too, and
  `lib/session-delete.ts` offers no delete until every read it names succeeded.
  The sibling readers - `getSessions`, `getSessionEnvironments`,
  `getLatestSessionsByVehicle`, `getComparableSessions` - still discard theirs;
  none feeds a write, so they degrade a display only, and that is the line to
  check before copying one

