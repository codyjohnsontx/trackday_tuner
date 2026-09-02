-- `replace_session_laps` deletes every lap on the session before it inserts, and
-- had no way to tell a replacement the rider meant from one built on laps the
-- caller never managed to read. `getSessionLaps` discarding its Supabase error
-- was that caller: a failed select came back as `[]`, the session page offered
-- "Add Lap Times" on a session that held twenty, and the rider retyping five of
-- them destroyed the other fifteen. That caller is fixed in the same change, but
-- the function protects callers that have not been written yet, so it now asks
-- how many laps the caller believes are stored and refuses the delete when that
-- NUMBER differs from what is there.
--
-- WHAT THIS GUARD DOES AND DOES NOT CATCH. It compares a count, and nothing
-- else. That is enough for the failure this migration is named after, where the
-- caller read nothing and the session holds laps, because 0 differs from 20. It
-- is NOT a general protection against overwriting laps the caller never saw, and
-- the equal-count case is the one to know about:
--
--   two tabs both load a session holding 12 laps; the first edits lap TIMES or
--   `included` flags without adding or removing a row and saves; the second tab
--   then saves its own stale snapshot with p_expected_lap_count = 12; 12 still
--   equals 12, this guard passes, and the first tab's edits are overwritten
--   silently.
--
-- That case is open on purpose rather than overlooked. Catching it means the
-- caller sending a version or a content hash of the set it read, which is a real
-- decision about what identity a lap set has and needs its own test surface, so
-- it is tracked separately rather than folded into a data-loss fix. Do not read
-- any comment in this repository as promising more than the count comparison
-- below; if one does, it is wrong and should be narrowed to this.
--
-- The parameter is required rather than defaulted, and the three-argument
-- function is dropped rather than left beside this one. A default, or a
-- surviving overload, keeps the unguarded call shape working - which is exactly
-- the shape the next caller reaches for. `create or replace` with an added
-- parameter creates an overload rather than replacing, so the drop is what makes
-- this the only way in.
--
-- 20260717000900 created the function and is already applied, so it is not
-- edited: everything below is the body it holds, plus the guard and the
-- `stored_lap_count` it needs. `drop function` takes the function's privileges
-- with it, so the revoke/grant pair is restated here.
--
-- APPLY THIS MIGRATION BEFORE MERGING THE PULL REQUEST THAT SHIPS ITS CALLER.
-- Dropping the overload means the signature changes, and migrations are applied
-- by hand here while Vercel deploys on merge - so the merge is the moment the
-- new code goes live and the migration is the step that has to already be done.
-- Either order leaves a window, and both were walked in a browser against a
-- rebuilt stack rather than reasoned about:
--
--   migration first, old code still live -> PostgREST answers PGRST202 for
--     `replace_session_laps(p_laps, p_session_id, p_user_id)`
--   deploy first, migration not yet applied -> the same for
--     `(p_expected_lap_count, p_laps, p_session_id, p_user_id)`
--
-- Both fail LOUDLY and identically: the message is rendered to the rider, no
-- "Lap data saved." appears, the stored laps survive untouched, and a new
-- session rolls back with no half-written row and no orphan track. The window is
-- a visible outage on saving, not a silent one - which matters here, because a
-- save that appears to work while dropping data is the class of bug this whole
-- migration exists to close.
--
-- The window covers LOGGING A SESSION as well as saving laps: `createSession`
-- calls this function on every save, including a session with no laps at all.
-- Reading a session, and every other screen, is unaffected.

drop function if exists public.replace_session_laps(uuid, uuid, jsonb);

create or replace function public.replace_session_laps(
  p_user_id uuid,
  p_session_id uuid,
  p_laps jsonb,
  p_expected_lap_count integer
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  session_vehicle_id uuid;
  stored_lap_count integer;
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

  -- `for update` is what makes the count below mean anything: it locks the
  -- session row for the rest of this transaction, so two calls of this function
  -- against the same session serialize and neither can insert laps between the
  -- other's count and its delete. Different sessions do not block each other. It
  -- does not stop a write sent straight at `session_laps`, which `authenticated`
  -- still holds insert, update and delete on - the guard is about callers that
  -- go through this function, and RLS is what bounds the rest.
  --
  -- Serializing the two calls is not the same as telling them apart. Two saves
  -- that each read 12 laps still both see 12 here, one after the other, and the
  -- second overwrites the first - see the equal-count case in the header.
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

  -- The guard. A null is a caller that named the argument and passed nothing
  -- rather than one that omitted it, and it is refused for the same reason a
  -- missing argument is: it states no belief about what is here to delete.
  if p_expected_lap_count is null or p_expected_lap_count < 0 then
    raise exception 'replace_session_laps needs the number of laps the caller read'
      using errcode = 'TT409';
  end if;

  select count(*) into stored_lap_count
  from public.session_laps
  where user_id = p_user_id and session_id = p_session_id;

  if stored_lap_count <> p_expected_lap_count then
    raise exception 'replace_session_laps stale read: % laps stored, caller expected %',
      stored_lap_count, p_expected_lap_count
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

revoke all on function public.replace_session_laps(uuid, uuid, jsonb, integer) from public, anon;
grant execute on function public.replace_session_laps(uuid, uuid, jsonb, integer) to authenticated;
