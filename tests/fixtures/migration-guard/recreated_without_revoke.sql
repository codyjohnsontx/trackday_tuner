-- Loaded after definer_with_revoke.sql. Dropping promote_rider(uuid) takes its
-- privileges with it, so the function created again here starts at Postgres's
-- default - execute to public - and this file does not decide it.

drop function if exists public.promote_rider(uuid);

create function public.promote_rider(
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.profiles set plan = 'pro' where id = p_user_id;
end;
$$;
