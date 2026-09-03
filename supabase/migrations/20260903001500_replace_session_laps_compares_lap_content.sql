-- `replace_session_laps` refused a replacement whose lap COUNT disagreed with
-- what the caller read (20260901001400). That header records the case the count
-- leaves open, and this migration closes it:
--
--   two tabs both load a session holding 12 laps; the first edits lap TIMES or
--   `included` flags without adding or removing a row and saves; the second tab
--   then saves its own stale snapshot; 12 still equals 12, the count guard
--   passes, and the first tab's edits are overwritten silently.
--
-- That was reproduced against a database built from these migrations before
-- anything here was written: lap 3 re-timed to 98.000 and lap 7 excluded by the
-- first save, both back to their seeded values after the second, no error
-- anywhere. The guard now compares the CONTENT of the stored set rather than its
-- size, so the second save is refused with the same `TT409` and the first tab's
-- work survives.
--
-- 20260901001400's header describes the guard as it stood at that migration and
-- is not edited, because an applied migration never is. Its sentence "do not
-- read any comment in this repository as promising more than the count
-- comparison below" is superseded HERE and nowhere else; `AGENTS.md` carries the
-- same pointer.
--
-- WHAT IDENTITY A LAP SET HAS, AND WHERE IT LIVES
--
-- The identity is the set of `(lap_number, lap_time_ms, included)` triples the
-- session holds, in a canonical order. It is DERIVED from the rows on every
-- comparison rather than stored in a column, and `session_laps_identity` below
-- is the only definition of it. Both sides of the guard - the rows in the table
-- and the set the caller says it read - are run through that one function, so
-- the two cannot drift into being two records of one fact.
--
-- Derived rather than a stored stamp column, and that is the load-bearing
-- choice:
--
--   * a stamp only tracks content while every writer remembers to bump it, and
--     `authenticated` holds insert, update and delete on `session_laps`
--     directly (see 20260719001100). A row changed through the Data API would
--     leave the stamp saying "unchanged" while the laps had moved, so the guard
--     would pass exactly the stale save it exists to refuse. A derived identity
--     cannot say that, because it is read off the rows themselves;
--   * a stamp needs a value for every session that already exists. A derived
--     identity needs no backfill and no null-tolerant compare, and a
--     null-tolerant compare is a hole;
--   * a stamp is an additive column and a schema change, and this needs neither.
--
-- The caller echoes back the laps it read rather than a hash it computed. A
-- digest folded in TypeScript and a digest folded in SQL are two implementations
-- of one fact and drift the moment either is touched, and the caller is already
-- holding the rows, so echoing them costs a few kilobytes and keeps the fold in
-- one place - here. Note what that means for a caller that sends nonsense: it
-- cannot match any real set, so it is REFUSED rather than throwing, which is the
-- direction a guard should fail in.
--
-- `source` is deliberately NOT part of the identity. The lap editor's
-- `CreateSessionLapInput` carries only the three columns above, so a set stored
-- as `import` could never be matched by a caller that can only describe what it
-- can see, and every save against imported laps would be refused forever. A
-- guard that refuses legitimate saves is worse for a rider than the gap it
-- closes. The identity therefore covers exactly what a rider can see and edit.
--
-- THE TELEMETRY SUMMARY REWRITE ON THIS SAME PATH CANNOT AFFECT IT. The identity
-- reads `session_laps` and nothing else, so the `telemetry_summaries` upsert at
-- the bottom of this function - which runs on every successful save and stamps
-- `updated_at` - is invisible to it. That is why the identity is not hung off
-- that table's `updated_at`, which is the shortcut this design most invites: the
-- row is DELETED when the last lap goes, `authenticated` can write it outright,
-- and the upsert is conditional on `source = 'manual'`, so it is absent, forgeable
-- and skippable in turn. `tests/e2e/session-laps-stale-read-guard.spec.ts` pins
-- the property from both ends - a save right after the summary was rewritten by
-- this function, and one after the rider rewrote the summary row themselves.
--
-- WHAT IS STILL NOT CAUGHT. Two saves carrying the SAME laps are indistinguishable
-- from one save, because they are: the stored set the second one leaves behind is
-- the set it claimed to have read. Nothing is lost, so there is nothing to refuse.
-- This is a guard against overwriting content the caller never saw, and content is
-- the whole of what it compares.
--
-- The parameter replaces `p_expected_lap_count` rather than joining it. Two ways
-- to state the same belief means a caller can state only the weak one, and the
-- weak one is the shape that shipped the gap above. `create or replace` with a
-- changed parameter TYPE creates an overload rather than a replacement, so the
-- count signature is dropped for the same reason 20260901001400 dropped the
-- three-argument one - a surviving overload is the call shape the next caller
-- reaches for. The three-argument drop is repeated here so "there is one way in"
-- holds against any history, not only against a clean build.
--
-- APPLY THIS MIGRATION BEFORE MERGING THE PULL REQUEST THAT SHIPS ITS CALLER.
-- The signature changes again, so the same window 20260901001400 documented
-- applies unchanged: whichever side goes first, the other gets `PGRST202` from
-- PostgREST for the signature it asked for, the message is rendered to the
-- rider, no "Lap data saved." appears, the stored laps survive untouched, and a
-- new session rolls back with no half-written row and no orphan track. Saving
-- laps and LOGGING A SESSION are both down for that window, because
-- `createSession` calls this function on every save including a session with no
-- laps; reading is unaffected. A visible outage on saving, not a silent one.

-- The identity of a set of laps: its `(lap_number, lap_time_ms, included)`
-- triples in a canonical order, so two sets that hold the same laps in a
-- different order are the same identity and any difference in a time or an
-- `included` flag is a different one.
--
-- Everything about it is chosen so it cannot raise. Elements are read with `->`,
-- which answers NULL for a missing key or a non-object rather than erroring, and
-- nothing is cast, so a malformed claim canonicalises to a value that matches no
-- real set instead of throwing a cast error at a caller. Values stay as jsonb
-- rather than becoming text so numbers compare numerically: a caller that sends
-- `3.0` where the column holds `3` is the same lap, and refusing it would be a
-- false refusal. Sorting on the built entry is what makes the order canonical,
-- and it needs no cast because it sorts the same jsonb values it aggregates.
--
-- `jsonb_array_elements` is the one thing here that raises on bad input - it
-- needs an array - so every caller checks `jsonb_typeof` first.
create or replace function public.session_laps_identity(p_laps jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(entry order by entry), '[]'::jsonb)
  from (
    select jsonb_build_array(
      lap->'lap_number',
      lap->'lap_time_ms',
      lap->'included'
    ) as entry
    from jsonb_array_elements(p_laps) lap
  ) entries;
$$;

revoke all on function public.session_laps_identity(jsonb) from public, anon;
grant execute on function public.session_laps_identity(jsonb) to authenticated;

-- Repeated from 20260901001400 so the "one way in" claim holds whatever history
-- a database carries, not only a clean build of these files.
drop function if exists public.replace_session_laps(uuid, uuid, jsonb);
drop function if exists public.replace_session_laps(uuid, uuid, jsonb, integer);

create or replace function public.replace_session_laps(
  p_user_id uuid,
  p_session_id uuid,
  p_laps jsonb,
  p_expected_laps jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  session_vehicle_id uuid;
  stored_identity jsonb;
  claimed_identity jsonb;
  included_count integer;
  best_lap integer;
  average_lap integer;
  consistency_spread integer;
  included_lap_times jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'replace_session_laps caller mismatch';
  end if;

  if jsonb_typeof(p_laps) is distinct from 'array' then
    raise exception 'laps must be an array';
  end if;

  if jsonb_array_length(p_laps) > 200 then
    raise exception 'sessions cannot exceed 200 laps';
  end if;

  -- `for update` is what makes the comparison below mean anything: it locks the
  -- session row for the rest of this transaction, so two calls of this function
  -- against the same session serialize and neither can change laps between the
  -- other's read and its delete. Different sessions do not block each other. It
  -- does not stop a write sent straight at `session_laps`, which `authenticated`
  -- still holds insert, update and delete on - but unlike the count this guard
  -- replaced, such a write cannot hide behind the lock either: it changes the
  -- content, so it changes the identity, and the next save built on the old
  -- content is refused.
  select vehicle_id into session_vehicle_id
  from public.sessions
  where id = p_session_id and user_id = p_user_id
  for update;

  if session_vehicle_id is null then
    raise exception 'session not found';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_laps) lap
    where jsonb_typeof(lap) is distinct from 'object'
      or jsonb_typeof(lap->'lap_number') is distinct from 'number'
      or jsonb_typeof(lap->'lap_time_ms') is distinct from 'number'
      or jsonb_typeof(lap->'included') is distinct from 'boolean'
  ) then
    raise exception 'invalid lap object';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_laps) lap
    where (lap->>'lap_number') !~ '^\d+$'
      or (lap->>'lap_time_ms') !~ '^\d+$'
      or (lap->>'lap_number')::integer not between 1 and 500
      or (lap->>'lap_time_ms')::integer not between 10000 and 1200000
  ) then
    raise exception 'lap values out of range';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_laps) lap
    group by (lap->>'lap_number')::integer
    having count(*) > 1
  ) then
    raise exception 'lap numbers must be unique';
  end if;

  -- The guard. A caller that names the argument and passes nothing, or passes
  -- something that is not a list of laps, is refused for the same reason a
  -- missing argument is: it states no belief this function can check. It shares
  -- the stale-read code because it has the same remedy - reload and try again -
  -- and because there is nothing here a rider could do about a distinction
  -- between the two.
  if p_expected_laps is null or jsonb_typeof(p_expected_laps) is distinct from 'array' then
    raise exception 'replace_session_laps needs the laps the caller read'
      using errcode = 'TT409';
  end if;

  select public.session_laps_identity(coalesce(
    jsonb_agg(jsonb_build_object(
      'lap_number', lap_number,
      'lap_time_ms', lap_time_ms,
      'included', included
    )),
    '[]'::jsonb
  ))
  into stored_identity
  from public.session_laps
  where user_id = p_user_id and session_id = p_session_id;

  claimed_identity := public.session_laps_identity(p_expected_laps);

  if stored_identity is distinct from claimed_identity then
    raise exception
      'replace_session_laps stale read: the stored laps (%) are not the ones the caller read (%)',
      jsonb_array_length(stored_identity), jsonb_array_length(claimed_identity)
      using errcode = 'TT409';
  end if;

  delete from public.session_laps
  where user_id = p_user_id and session_id = p_session_id;

  insert into public.session_laps (
    user_id, session_id, lap_number, lap_time_ms, included, source
  )
  select
    p_user_id,
    p_session_id,
    (lap->>'lap_number')::integer,
    (lap->>'lap_time_ms')::integer,
    (lap->>'included')::boolean,
    'manual'
  from jsonb_array_elements(p_laps) lap;

  if jsonb_array_length(p_laps) = 0 then
    delete from public.telemetry_summaries
    where user_id = p_user_id
      and session_id = p_session_id
      and source = 'manual';
    return;
  end if;

  select
    count(*) filter (where included),
    min(lap_time_ms) filter (where included),
    round(avg(lap_time_ms) filter (where included))::integer,
    (max(lap_time_ms) filter (where included) - min(lap_time_ms) filter (where included)),
    coalesce(
      jsonb_agg(lap_time_ms order by lap_number) filter (where included),
      '[]'::jsonb
    )
  into included_count, best_lap, average_lap, consistency_spread, included_lap_times
  from public.session_laps
  where user_id = p_user_id and session_id = p_session_id;

  insert into public.telemetry_summaries (
    user_id, session_id, vehicle_id, source, summary, metrics, updated_at
  ) values (
    p_user_id,
    p_session_id,
    session_vehicle_id,
    'manual',
    included_count || ' included manual laps',
    jsonb_build_object(
      'lap_count', included_count,
      'best_lap_ms', best_lap,
      'average_lap_ms', average_lap,
      'consistency_spread_ms', consistency_spread,
      'lap_times_ms', included_lap_times
    ),
    now()
  )
  on conflict (session_id) do update set
    user_id = excluded.user_id,
    vehicle_id = excluded.vehicle_id,
    source = excluded.source,
    summary = excluded.summary,
    metrics = excluded.metrics,
    updated_at = now()
  where telemetry_summaries.source = 'manual';
end;
$$;

revoke all on function public.replace_session_laps(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.replace_session_laps(uuid, uuid, jsonb, jsonb) to authenticated;
