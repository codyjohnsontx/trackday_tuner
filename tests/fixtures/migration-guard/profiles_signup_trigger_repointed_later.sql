-- A later migration that leaves a trigger on auth.users and points it somewhere
-- else. Signup still fires something, and the trigger still has the name the
-- migration before it gave it; it no longer creates the profiles row.
--
-- Written with `create or replace trigger`, which Postgres accepts and which is
-- the shortest way anyone would actually re-point an existing trigger.

create or replace function public.audit_new_auth_user()
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

revoke all on function public.audit_new_auth_user() from public, anon, authenticated;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.audit_new_auth_user();
