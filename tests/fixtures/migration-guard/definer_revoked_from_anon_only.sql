-- A revoke that looks like the real thing and leaves the hole open.
--
-- `anon` and `authenticated` are both members of `public`, so taking execute
-- away from them by name changes nothing while public still holds it. Postgres
-- accepts the statement without complaint and the function stays callable over
-- PostgREST with the anon key.
--
-- This is why the check asks for `public` in the role list rather than for any
-- revoke at all: the two spellings are one word apart in the diff and only one
-- of them closes anything.

create or replace function public.promote_rider(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set plan = 'pro' where id = p_user_id;
end;
$$;

revoke all on function public.promote_rider(uuid)
  from anon, authenticated;
grant execute on function public.promote_rider(uuid)
  to service_role;
