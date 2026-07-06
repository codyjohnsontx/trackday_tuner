create table if not exists public.session_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  reference_kind text not null,
  reference_session_id uuid references public.sessions(id) on delete set null,
  reference_label text not null,
  reference_date date,
  changes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_changes_reference_kind_check
    check (reference_kind in ('previous', 'baseline'))
);

create unique index if not exists session_changes_session_reference_key
  on public.session_changes(session_id, reference_kind);

create index if not exists session_changes_user_session_idx
  on public.session_changes(user_id, session_id);

create index if not exists session_changes_user_vehicle_created_idx
  on public.session_changes(user_id, vehicle_id, created_at desc);

-- Supports the reference_session_id foreign key so deleting a session does not
-- force a sequential scan of session_changes to apply `on delete set null`.
create index if not exists session_changes_reference_session_idx
  on public.session_changes(reference_session_id);

drop trigger if exists session_changes_set_updated_at on public.session_changes;
create trigger session_changes_set_updated_at
  before update on public.session_changes
  for each row execute function public.set_updated_at();

alter table public.session_changes enable row level security;

create policy "session_changes: select own"
  on public.session_changes for select
  using (auth.uid() = user_id);

create policy "session_changes: insert own"
  on public.session_changes for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.sessions s
      where s.id = session_id and s.user_id = auth.uid() and s.vehicle_id = session_changes.vehicle_id
    )
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_id and v.user_id = auth.uid()
    )
  );

create policy "session_changes: update own"
  on public.session_changes for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.sessions s
      where s.id = session_id and s.user_id = auth.uid() and s.vehicle_id = session_changes.vehicle_id
    )
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_id and v.user_id = auth.uid()
    )
  );

create policy "session_changes: delete own"
  on public.session_changes for delete
  using (auth.uid() = user_id);
