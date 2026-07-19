create table if not exists public.session_laps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  lap_number smallint not null,
  lap_time_ms integer not null,
  included boolean not null default true,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_laps_lap_number_check check (lap_number between 1 and 500),
  constraint session_laps_lap_time_check check (lap_time_ms between 10000 and 1200000),
  constraint session_laps_source_check check (source in ('manual', 'import'))
);

create unique index if not exists session_laps_session_number_key
  on public.session_laps(session_id, lap_number);

create index if not exists session_laps_user_session_idx
  on public.session_laps(user_id, session_id);

create or replace function public.replace_session_laps(
  p_user_id uuid,
  p_session_id uuid,
  p_laps jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  session_vehicle_id uuid;
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

  select vehicle_id into session_vehicle_id
  from public.sessions
  where id = p_session_id and user_id = p_user_id;

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
    updated_at = now();
end;
$$;

revoke all on function public.replace_session_laps(uuid, uuid, jsonb) from public, anon;
grant execute on function public.replace_session_laps(uuid, uuid, jsonb) to authenticated;

drop trigger if exists session_laps_set_updated_at on public.session_laps;
create trigger session_laps_set_updated_at
  before update on public.session_laps
  for each row execute function public.set_updated_at();

alter table public.session_laps enable row level security;

create policy "session_laps: select own"
  on public.session_laps for select
  using (auth.uid() = user_id);

create policy "session_laps: insert own"
  on public.session_laps for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

create policy "session_laps: update own"
  on public.session_laps for update
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

create policy "session_laps: delete own"
  on public.session_laps for delete
  using (auth.uid() = user_id);
