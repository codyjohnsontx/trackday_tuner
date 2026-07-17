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
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "session_laps: delete own"
  on public.session_laps for delete
  using (auth.uid() = user_id);
