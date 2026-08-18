-- The repository as it stood before 20260816001200: a profiles table keyed to
-- auth.users, and nothing that ever puts a row in it.
--
-- Every migration here applies cleanly and every test that reads them passes.
-- The table exists, the policies are right, the grants are right. The only thing
-- missing is a writer, and the app finds out about it at the checkout route,
-- which cannot attach a Stripe customer to a row that is not there.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free'
);

alter table public.profiles enable row level security;

create policy "profiles: select own"
  on public.profiles for select
  using (auth.uid() = id);
