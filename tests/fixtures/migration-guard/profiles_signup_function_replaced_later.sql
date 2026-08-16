-- A later migration that leaves the trigger alone and rewrites the function
-- underneath it.
--
-- The hardest of the three to see by reading, because nothing about the trigger
-- changes: it is still attached to auth.users, still named the same, and still
-- calls public.handle_new_auth_user. `create or replace` supersedes the earlier
-- body outright, so the insert in the migration that installed it is still there
-- to read and no longer runs.

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
