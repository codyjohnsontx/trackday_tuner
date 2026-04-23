alter table public.sessions
  add column if not exists updated_at timestamptz not null default now();

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
  on public.race_engineer_memory(user_id, vehicle_id, coalesce(track_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists race_engineer_memory_user_vehicle_idx
  on public.race_engineer_memory(user_id, vehicle_id, updated_at desc);

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
  with check (auth.uid() = user_id);

create policy "session_environment: update own"
  on public.session_environment for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "session_environment: delete own"
  on public.session_environment for delete
  using (auth.uid() = user_id);

create policy "ai_recommendations: select own"
  on public.ai_recommendations for select
  using (auth.uid() = user_id);

create policy "ai_recommendations: insert own"
  on public.ai_recommendations for insert
  with check (auth.uid() = user_id);

create policy "ai_recommendations: update own"
  on public.ai_recommendations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "session_feedback: select own"
  on public.session_feedback for select
  using (auth.uid() = user_id);

create policy "session_feedback: insert own"
  on public.session_feedback for insert
  with check (auth.uid() = user_id);

create policy "session_feedback: update own"
  on public.session_feedback for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "session_feedback: delete own"
  on public.session_feedback for delete
  using (auth.uid() = user_id);

create policy "race_engineer_memory: select own"
  on public.race_engineer_memory for select
  using (auth.uid() = user_id);

create policy "race_engineer_memory: insert own"
  on public.race_engineer_memory for insert
  with check (auth.uid() = user_id);

create policy "race_engineer_memory: update own"
  on public.race_engineer_memory for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "telemetry_summaries: select own"
  on public.telemetry_summaries for select
  using (auth.uid() = user_id);

create policy "telemetry_summaries: insert own"
  on public.telemetry_summaries for insert
  with check (auth.uid() = user_id);

create policy "telemetry_summaries: update own"
  on public.telemetry_summaries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
