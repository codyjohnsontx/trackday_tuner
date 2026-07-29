alter table public.sessions
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sessions_set_updated_at on public.sessions;
create trigger sessions_set_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();

create table if not exists public.session_environment (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  ambient_temperature_c double precision,
  track_temperature_c double precision,
  humidity_percent double precision,
  weather_condition text,
  surface_condition text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_environment_source_check
    check (source in ('manual', 'forecast', 'telemetry')),
  constraint session_environment_humidity_check
    check (humidity_percent is null or (humidity_percent >= 0 and humidity_percent <= 100))
);

create unique index if not exists session_environment_session_id_key
  on public.session_environment(session_id);

create index if not exists session_environment_user_session_idx
  on public.session_environment(user_id, session_id);

create table if not exists public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  track_id uuid references public.tracks(id) on delete set null,
  request_id text not null,
  summary text not null,
  component text,
  direction text,
  magnitude text,
  predicted_effect text,
  status text not null default 'proposed',
  advice jsonb not null default '{}'::jsonb,
  context_snapshot jsonb not null default '{}'::jsonb,
  outcome_session_id uuid references public.sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_recommendations_status_check
    check (status in ('proposed', 'applied', 'rejected', 'superseded'))
);

create index if not exists ai_recommendations_user_vehicle_created_idx
  on public.ai_recommendations(user_id, vehicle_id, created_at desc);

create index if not exists ai_recommendations_request_id_idx
  on public.ai_recommendations(request_id);

create table if not exists public.session_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  track_id uuid references public.tracks(id) on delete set null,
  recommendation_id uuid references public.ai_recommendations(id) on delete set null,
  outcome text not null,
  rider_confidence smallint,
  symptoms text[] not null default '{}'::text[],
  notes text,
  lap_time_delta_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_feedback_outcome_check
    check (outcome in ('better', 'same', 'worse', 'unknown')),
  constraint session_feedback_confidence_check
    check (rider_confidence is null or (rider_confidence >= 1 and rider_confidence <= 5))
);

create index if not exists session_feedback_user_vehicle_created_idx
  on public.session_feedback(user_id, vehicle_id, created_at desc);

create index if not exists session_feedback_session_idx
  on public.session_feedback(session_id);

create table if not exists public.race_engineer_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  track_id uuid references public.tracks(id) on delete cascade,
  summary text not null default '',
  patterns jsonb not null default '{}'::jsonb,
  evidence_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint race_engineer_memory_evidence_count_check
    check (evidence_count >= 0)
);

create unique index if not exists race_engineer_memory_scope_key
  on public.race_engineer_memory(user_id, vehicle_id, track_id) nulls not distinct;

create index if not exists race_engineer_memory_user_vehicle_idx
  on public.race_engineer_memory(user_id, vehicle_id, updated_at desc);

create or replace function public.record_race_engineer_memory_feedback(
  p_user_id uuid,
  p_vehicle_id uuid,
  p_track_id uuid,
  p_session_id uuid,
  p_track_name text,
  p_session_date date,
  p_outcome text,
  p_symptoms text[],
  p_notes text
)
returns void
language plpgsql
security invoker
as $$
declare
  latest_summary text;
  latest_feedback jsonb;
  session_scope_ok boolean;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'record_race_engineer_memory_feedback caller mismatch';
  end if;

  select exists (
    select 1
    from public.sessions s
    where s.id = p_session_id
      and s.user_id = auth.uid()
      and s.vehicle_id = p_vehicle_id
      and (
        (p_track_id is null and s.track_id is null)
        or s.track_id = p_track_id
      )
  )
  into session_scope_ok;

  if not session_scope_ok then
    raise exception 'record_race_engineer_memory_feedback session scope mismatch';
  end if;

  latest_summary := format(
    'Latest feedback at %s: %s with %s.%s',
    coalesce(p_track_name, 'unknown track'),
    p_outcome,
    case
      when coalesce(array_length(p_symptoms, 1), 0) > 0 then array_to_string(p_symptoms, ', ')
      else 'no structured symptoms'
    end,
    case
      when p_notes is not null and btrim(p_notes) <> '' then ' Notes: ' || p_notes
      else ''
    end
  );

  latest_feedback := jsonb_build_object(
    'session_id', p_session_id,
    'track_name', p_track_name,
    'outcome', p_outcome,
    'symptoms', coalesce(to_jsonb(p_symptoms), '[]'::jsonb),
    'notes', p_notes,
    'date', p_session_date
  );

  insert into public.race_engineer_memory (
    user_id,
    vehicle_id,
    track_id,
    summary,
    patterns,
    evidence_count,
    updated_at
  )
  values (
    p_user_id,
    p_vehicle_id,
    p_track_id,
    latest_summary,
    jsonb_build_object('last_feedback', latest_feedback),
    1,
    now()
  )
  on conflict (user_id, vehicle_id, track_id) do update
  set
    summary = substring(
      case
        when public.race_engineer_memory.summary is null or public.race_engineer_memory.summary = '' then latest_summary
        else latest_summary || E'\n' || public.race_engineer_memory.summary
      end
      from 1 for 1800
    ),
    patterns = coalesce(public.race_engineer_memory.patterns, '{}'::jsonb)
      || jsonb_build_object('last_feedback', latest_feedback),
    evidence_count = public.race_engineer_memory.evidence_count + 1,
    updated_at = now();
end;
$$;

create table if not exists public.telemetry_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  source text not null default 'import',
  summary text,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists telemetry_summaries_session_id_key
  on public.telemetry_summaries(session_id);

create index if not exists telemetry_summaries_user_vehicle_created_idx
  on public.telemetry_summaries(user_id, vehicle_id, created_at desc);

drop trigger if exists session_environment_set_updated_at on public.session_environment;
create trigger session_environment_set_updated_at
  before update on public.session_environment
  for each row execute function public.set_updated_at();

drop trigger if exists ai_recommendations_set_updated_at on public.ai_recommendations;
create trigger ai_recommendations_set_updated_at
  before update on public.ai_recommendations
  for each row execute function public.set_updated_at();

drop trigger if exists session_feedback_set_updated_at on public.session_feedback;
create trigger session_feedback_set_updated_at
  before update on public.session_feedback
  for each row execute function public.set_updated_at();

drop trigger if exists race_engineer_memory_set_updated_at on public.race_engineer_memory;
create trigger race_engineer_memory_set_updated_at
  before update on public.race_engineer_memory
  for each row execute function public.set_updated_at();

drop trigger if exists telemetry_summaries_set_updated_at on public.telemetry_summaries;
create trigger telemetry_summaries_set_updated_at
  before update on public.telemetry_summaries
  for each row execute function public.set_updated_at();

alter table public.session_environment enable row level security;
alter table public.ai_recommendations enable row level security;
alter table public.session_feedback enable row level security;
alter table public.race_engineer_memory enable row level security;
alter table public.telemetry_summaries enable row level security;

create policy "session_environment: select own"
  on public.session_environment for select
  using (auth.uid() = user_id);

create policy "session_environment: insert own"
  on public.session_environment for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

create policy "session_environment: update own"
  on public.session_environment for update
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

create policy "session_environment: delete own"
  on public.session_environment for delete
  using (auth.uid() = user_id);

create policy "ai_recommendations: select own"
  on public.ai_recommendations for select
  using (auth.uid() = user_id);

create policy "ai_recommendations: insert own"
  on public.ai_recommendations for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_id and v.user_id = auth.uid()
    )
    and (
      session_id is null
      or exists (
        select 1
        from public.sessions s
        where s.id = session_id and s.user_id = auth.uid() and s.vehicle_id = ai_recommendations.vehicle_id
      )
    )
    and (
      track_id is null
      or exists (
        select 1
        from public.tracks t
        where t.id = track_id and (t.created_by = auth.uid() or t.is_seeded = true)
      )
    )
    and (
      outcome_session_id is null
      or exists (
        select 1
        from public.sessions s
        where s.id = outcome_session_id and s.user_id = auth.uid() and s.vehicle_id = ai_recommendations.vehicle_id
      )
    )
  );

create policy "ai_recommendations: update own"
  on public.ai_recommendations for update
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_id and v.user_id = auth.uid()
    )
    and (
      session_id is null
      or exists (
        select 1
        from public.sessions s
        where s.id = session_id and s.user_id = auth.uid() and s.vehicle_id = ai_recommendations.vehicle_id
      )
    )
    and (
      track_id is null
      or exists (
        select 1
        from public.tracks t
        where t.id = track_id and (t.created_by = auth.uid() or t.is_seeded = true)
      )
    )
    and (
      outcome_session_id is null
      or exists (
        select 1
        from public.sessions s
        where s.id = outcome_session_id and s.user_id = auth.uid() and s.vehicle_id = ai_recommendations.vehicle_id
      )
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_id and v.user_id = auth.uid()
    )
    and (
      session_id is null
      or exists (
        select 1
        from public.sessions s
        where s.id = session_id and s.user_id = auth.uid() and s.vehicle_id = ai_recommendations.vehicle_id
      )
    )
    and (
      track_id is null
      or exists (
        select 1
        from public.tracks t
        where t.id = track_id and (t.created_by = auth.uid() or t.is_seeded = true)
      )
    )
    and (
      outcome_session_id is null
      or exists (
        select 1
        from public.sessions s
        where s.id = outcome_session_id and s.user_id = auth.uid() and s.vehicle_id = ai_recommendations.vehicle_id
      )
    )
  );

create policy "ai_recommendations: delete own"
  on public.ai_recommendations for delete
  using (auth.uid() = user_id);

create policy "session_feedback: select own"
  on public.session_feedback for select
  using (auth.uid() = user_id);

create policy "session_feedback: insert own"
  on public.session_feedback for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.sessions s
      where s.id = session_id and s.user_id = auth.uid() and s.vehicle_id = session_feedback.vehicle_id
    )
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_id and v.user_id = auth.uid()
    )
    and (
      track_id is null
      or exists (
        select 1
        from public.tracks t
        where t.id = track_id and (t.created_by = auth.uid() or t.is_seeded = true)
      )
    )
    and (
      recommendation_id is null
      or exists (
        select 1
        from public.ai_recommendations r
        where r.id = recommendation_id and r.user_id = auth.uid() and r.vehicle_id = session_feedback.vehicle_id
      )
    )
  );

create policy "session_feedback: update own"
  on public.session_feedback for update
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.sessions s
      where s.id = session_id and s.user_id = auth.uid() and s.vehicle_id = session_feedback.vehicle_id
    )
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_id and v.user_id = auth.uid()
    )
    and (
      track_id is null
      or exists (
        select 1
        from public.tracks t
        where t.id = track_id and (t.created_by = auth.uid() or t.is_seeded = true)
      )
    )
    and (
      recommendation_id is null
      or exists (
        select 1
        from public.ai_recommendations r
        where r.id = recommendation_id and r.user_id = auth.uid() and r.vehicle_id = session_feedback.vehicle_id
      )
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.sessions s
      where s.id = session_id and s.user_id = auth.uid() and s.vehicle_id = session_feedback.vehicle_id
    )
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_id and v.user_id = auth.uid()
    )
    and (
      track_id is null
      or exists (
        select 1
        from public.tracks t
        where t.id = track_id and (t.created_by = auth.uid() or t.is_seeded = true)
      )
    )
    and (
      recommendation_id is null
      or exists (
        select 1
        from public.ai_recommendations r
        where r.id = recommendation_id and r.user_id = auth.uid() and r.vehicle_id = session_feedback.vehicle_id
      )
    )
  );

create policy "session_feedback: delete own"
  on public.session_feedback for delete
  using (auth.uid() = user_id);

create policy "race_engineer_memory: select own"
  on public.race_engineer_memory for select
  using (auth.uid() = user_id);

create policy "race_engineer_memory: insert own"
  on public.race_engineer_memory for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_id and v.user_id = auth.uid()
    )
    and (
      track_id is null
      or exists (
        select 1
        from public.tracks t
        where t.id = track_id and (t.created_by = auth.uid() or t.is_seeded = true)
      )
    )
  );

create policy "race_engineer_memory: update own"
  on public.race_engineer_memory for update
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_id and v.user_id = auth.uid()
    )
    and (
      track_id is null
      or exists (
        select 1
        from public.tracks t
        where t.id = track_id and (t.created_by = auth.uid() or t.is_seeded = true)
      )
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_id and v.user_id = auth.uid()
    )
    and (
      track_id is null
      or exists (
        select 1
        from public.tracks t
        where t.id = track_id and (t.created_by = auth.uid() or t.is_seeded = true)
      )
    )
  );

create policy "race_engineer_memory: delete own"
  on public.race_engineer_memory for delete
  using (auth.uid() = user_id);

create policy "telemetry_summaries: select own"
  on public.telemetry_summaries for select
  using (auth.uid() = user_id);

create policy "telemetry_summaries: insert own"
  on public.telemetry_summaries for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.sessions s
      where s.id = session_id and s.user_id = auth.uid() and s.vehicle_id = telemetry_summaries.vehicle_id
    )
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_id and v.user_id = auth.uid()
    )
  );

create policy "telemetry_summaries: update own"
  on public.telemetry_summaries for update
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.sessions s
      where s.id = session_id and s.user_id = auth.uid() and s.vehicle_id = telemetry_summaries.vehicle_id
    )
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_id and v.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.sessions s
      where s.id = session_id and s.user_id = auth.uid() and s.vehicle_id = telemetry_summaries.vehicle_id
    )
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_id and v.user_id = auth.uid()
    )
  );

create policy "telemetry_summaries: delete own"
  on public.telemetry_summaries for delete
  using (auth.uid() = user_id);
