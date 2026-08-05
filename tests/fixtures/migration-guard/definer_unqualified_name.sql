-- A `security definer` function created without its schema qualifier.
--
-- Nothing requires a migration to write `public.`, and search_path puts this in
-- public just the same, so what ships is the function in definer_without_revoke.sql
-- under another spelling: callable over PostgREST with the anon key, running as
-- its owner, past every RLS policy.
--
-- A pattern that insisted on the qualifier would not match this at all, and a
-- check that matches nothing reports nothing.

create or replace function promote_rider(
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
