create table if not exists public.vehicle_baselines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  source_session_id uuid references public.sessions(id) on delete set null,

  source_track_id uuid references public.tracks(id) on delete set null,
  source_track_name text,
  source_date date not null,
  source_start_time time,
  source_session_number smallint,
  source_conditions text not null,

  tires jsonb not null default '{}'::jsonb,
  suspension jsonb not null default '{}'::jsonb,
  alignment jsonb,
  enabled_modules jsonb not null default '{}'::jsonb,
  extra_modules jsonb,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint vehicle_baselines_source_conditions_check
    check (source_conditions in ('sunny', 'overcast', 'rainy', 'mixed'))
);

create unique index if not exists vehicle_baselines_user_vehicle_key
  on public.vehicle_baselines(user_id, vehicle_id);

create index if not exists vehicle_baselines_user_vehicle_updated_idx
  on public.vehicle_baselines(user_id, vehicle_id, updated_at desc);

create index if not exists vehicle_baselines_source_session_idx
  on public.vehicle_baselines(source_session_id);

drop trigger if exists vehicle_baselines_set_updated_at on public.vehicle_baselines;
create trigger vehicle_baselines_set_updated_at
  before update on public.vehicle_baselines
  for each row execute function public.set_updated_at();

alter table public.vehicle_baselines enable row level security;

create policy "vehicle_baselines: select own"
  on public.vehicle_baselines for select
  using (auth.uid() = user_id);

create policy "vehicle_baselines: insert own"
  on public.vehicle_baselines for insert
  with check (auth.uid() = user_id);

create policy "vehicle_baselines: update own"
  on public.vehicle_baselines for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "vehicle_baselines: delete own"
  on public.vehicle_baselines for delete
  using (auth.uid() = user_id);
