-- The schema as 20260816001200 leaves it, and the only fixture here that is
-- deliberately right: a profiles table, a function that puts a row in it, and a
-- trigger on auth.users that runs the function.
--
-- It is loaded on its own to show the guard accepts it, and ahead of each
-- later-migration regression beside it so what the guard judges is the state the
-- whole chain ends in rather than the first file that installs a trigger. Note
-- the `drop trigger if exists` immediately before the create: that is a
-- precaution against a database that already has one, and must not read as the
-- trigger being taken away.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free'
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, tier)
  values (new.id, 'free')
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
