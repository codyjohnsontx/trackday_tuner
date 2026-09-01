-- `replace_session_laps` deletes every lap on the session before it inserts, and
-- had no way to tell a replacement the rider meant from one built on laps the
-- caller never managed to read. `getSessionLaps` discarding its Supabase error
-- was that caller: a failed select came back as `[]`, the session page offered
-- "Add Lap Times" on a session that held twenty, and the rider retyping five of
-- them destroyed the other fifteen. That caller is fixed in the same change, but
-- the function protects callers that have not been written yet, so it now asks
-- what the caller believes is stored and refuses the delete when the database
-- disagrees.
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
