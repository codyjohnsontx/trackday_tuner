-- Baseline for the four tables the app was built on before migrations existed.
--
-- profiles, vehicles, tracks and sessions were created by hand in the Supabase
-- dashboard, so no migration ever created them. Every later migration assumes
-- they are already there: the second one alters public.profiles and died on a
-- fresh database with "relation public.profiles does not exist", which meant no
-- new environment could be built from this repository at all.
--
-- This file is deliberately the *original* shape of those tables, not their
-- current shape. Columns the later migrations add stay in those migrations:
--   20260224000100  profiles.stripe_*
--   20260228000200  sessions.session_number, sessions.enabled_modules
--   20260422000400  sessions.updated_at (and the set_updated_at trigger)
--   20260716000800  profiles.beta_*
-- Reconstructed from types/supabase.ts, the columns those migrations alter, and
-- the foreign keys later tables declare against these four.
--
-- Everything here is written to be replayable: the hosted project already has
-- these tables, so a `drop policy if exists` precedes each policy rather than
-- the bare `create policy` the rest of the migrations use.

-- profiles ------------------------------------------------------------------
-- At most one row per auth user. When this baseline was written nothing created
-- that row automatically: no migration installed a trigger on auth.users, so
-- signing up through the ordinary email and password form left that user with no
-- profiles row at all, and the one writer was the beta signup route, which
-- inserts through the service-role client and so bypasses RLS entirely. That is
-- why the table has select and update policies for a user's own row but no insert
-- policy: a user is never the one creating it (the update policy is what lets
-- Stripe checkout link a customer id).
--
-- That gap is closed by 20260816001200_add_profile_on_auth_user_created.sql,
-- which installs an after-insert trigger on auth.users so every signup path gets
-- a row. Read that file before concluding from this one that nothing writes
-- profiles automatically. The policies below are unchanged by it and still
-- correct: the trigger inserts as the function's owner rather than as the user,
-- so there is still no insert policy to add here.
--
-- Comment only, on purpose. This migration is already applied on the remote, and
-- CLAUDE.md forbids editing an applied one because the edit changes the file
-- without changing the database. A comment is the one thing that cannot: replayed,
-- this file does exactly what it did before, and the guard in
-- tests/unit/migrations-bootstrap.test.ts strips comments before matching.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free',
  updated_at timestamptz not null default now(),
  constraint profiles_tier_check check (tier in ('free', 'pro'))
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: select own" on public.profiles;
create policy "profiles: select own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- vehicles ------------------------------------------------------------------
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null,
  type text not null,
  year integer,
  make text,
  model text,
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicles_type_check check (type in ('motorcycle', 'car'))
);

create index if not exists vehicles_user_id_created_at_idx
  on public.vehicles(user_id, created_at);

alter table public.vehicles enable row level security;

drop policy if exists "vehicles: select own" on public.vehicles;
create policy "vehicles: select own"
  on public.vehicles for select
  using (auth.uid() = user_id);

drop policy if exists "vehicles: insert own" on public.vehicles;
create policy "vehicles: insert own"
  on public.vehicles for insert
  with check (auth.uid() = user_id);

drop policy if exists "vehicles: update own" on public.vehicles;
create policy "vehicles: update own"
  on public.vehicles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "vehicles: delete own" on public.vehicles;
create policy "vehicles: delete own"
  on public.vehicles for delete
  using (auth.uid() = user_id);

-- tracks --------------------------------------------------------------------
-- Two kinds of row share this table: seeded global tracks (is_seeded, created_by
-- null) that everyone can read but nobody can edit, and per-user custom tracks.
-- lib/actions/tracks.ts reads a track by id alone and then re-checks
-- `is_seeded || created_by === userId` in TypeScript, so the select policy has to
-- be the union of both.
create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  is_seeded boolean not null default false,
  created_by uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists tracks_created_by_idx
  on public.tracks(created_by);

alter table public.tracks enable row level security;

drop policy if exists "tracks: select seeded or own" on public.tracks;
create policy "tracks: select seeded or own"
  on public.tracks for select
  using (is_seeded or auth.uid() = created_by);

drop policy if exists "tracks: insert own" on public.tracks;
create policy "tracks: insert own"
  on public.tracks for insert
  with check (auth.uid() = created_by and is_seeded = false);

drop policy if exists "tracks: update own" on public.tracks;
create policy "tracks: update own"
  on public.tracks for update
  using (auth.uid() = created_by and is_seeded = false)
  with check (auth.uid() = created_by and is_seeded = false);

drop policy if exists "tracks: delete own" on public.tracks;
create policy "tracks: delete own"
  on public.tracks for delete
  using (auth.uid() = created_by and is_seeded = false);

-- sessions ------------------------------------------------------------------
-- start_time is nullable on purpose; lib/session-compare.ts coalesces a missing
-- one to 00:00:00 rather than filtering it out in SQL.
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  track_id uuid references public.tracks(id) on delete set null,
  track_name text,
  date date not null,
  start_time time,
  conditions text not null,
  tires jsonb not null,
  suspension jsonb not null,
  alignment jsonb,
  extra_modules jsonb,
  notes text,
  created_at timestamptz not null default now(),
  constraint sessions_conditions_check
    check (conditions in ('sunny', 'overcast', 'rainy', 'mixed'))
);

create index if not exists sessions_user_id_date_idx
  on public.sessions(user_id, date desc);

create index if not exists sessions_vehicle_id_date_idx
  on public.sessions(vehicle_id, date desc);

alter table public.sessions enable row level security;

drop policy if exists "sessions: select own" on public.sessions;
create policy "sessions: select own"
  on public.sessions for select
  using (auth.uid() = user_id);

drop policy if exists "sessions: insert own" on public.sessions;
create policy "sessions: insert own"
  on public.sessions for insert
  with check (auth.uid() = user_id);

drop policy if exists "sessions: update own" on public.sessions;
create policy "sessions: update own"
  on public.sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "sessions: delete own" on public.sessions;
create policy "sessions: delete own"
  on public.sessions for delete
  using (auth.uid() = user_id);
