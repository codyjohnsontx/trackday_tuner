-- A trigger in the right place that does the wrong thing.
--
-- Checking only that *some* after-insert trigger exists on auth.users would pass
-- this: analytics, audit rows and welcome emails are all reasonable things to
-- hang there, and none of them creates the profiles row. The guard has to read
-- what the function does, not where it is attached.

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
  insert into public.product_events (event_name, user_id)
  values ('signup_completed', new.id);

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
