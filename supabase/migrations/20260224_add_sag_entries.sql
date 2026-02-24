create table if not exists public.sag_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  label text,
  notes text,
  front_l0 double precision,
  front_l1 double precision,
  front_l2 double precision,
  rear_l0 double precision,
  rear_l1 double precision,
  rear_l2 double precision,
  front_travel_mm double precision,
  rear_travel_mm double precision
);

alter table public.sag_entries enable row level security;

create policy "sag_entries: select own"
  on public.sag_entries for select
  using (auth.uid() = user_id);

create policy "sag_entries: insert own"
  on public.sag_entries for insert
  with check (auth.uid() = user_id);

create policy "sag_entries: update own"
  on public.sag_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "sag_entries: delete own"
  on public.sag_entries for delete
  using (auth.uid() = user_id);

create index if not exists sag_entries_user_id_created_at_idx
  on public.sag_entries(user_id, created_at desc);
