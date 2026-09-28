-- Create a session, its laps and its environment in one transaction.
--
-- Owner's decision of 2026-09-27 (option A): the phone's create is atomic. The
-- website writes a session as three statements - the row, then
-- `replace_session_laps`, then the environment - and deletes the row again when
-- a later one fails. That rollback is itself a statement, and a dead connection
-- fails it too, so a row could survive without its laps. The phone retries a
-- failed create on the same id, and a retry that found that row answered it as
-- synced: the laps were gone and nothing said so. Inside one function nothing
-- is written unless everything is.
--
-- `p_session_id` is the id the phone minted, which is what makes a retry safe.
-- A session with that id that this rider can already see was written whole by
-- an earlier call, so the function writes nothing and answers `replayed`. That
-- includes a concurrent call on the same id: its insert waits on the primary
-- key until the first commits, and then finds the first one's row. An id held
-- by a row this rider cannot see - another rider's - is re-raised as the
-- primary key's own `23505`, and the caller refuses it.
--
-- The vehicle has to be one of this rider's, checked before anything is
-- written. The `sessions: insert own` policy checks only `user_id`, so without
-- this a crafted body - or an outbox entry synced under a different account -
-- stored a session on another rider's vehicle, which that rider's delete would
-- then cascade away. It is raised as `TT404`, a code of its own, because the
-- phone parks a refusal it cannot fix and retries a fault: a vehicle deleted
-- since the session was logged lands here too, and no retry brings it back.
--
-- The laps go through `replace_session_laps` with an empty expected set rather
-- than being inserted here, so `session_laps` and the manual
-- `telemetry_summaries` row are written by the one definition of those rules.
--
-- `security invoker`: it runs as the rider, so RLS decides what the rider may
-- write and see exactly as the three separate statements it replaces did, and
-- `auth.uid()` is the owner of every row it writes. It returns
-- `{ "replayed": boolean, "session": <the stored row> }`.

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
