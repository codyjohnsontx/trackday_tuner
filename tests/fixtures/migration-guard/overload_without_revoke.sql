-- Loaded after definer_with_revoke.sql, which creates promote_rider(uuid) and
-- decides execute on it. This adds a second signature, the way this repository
-- changes a function's arguments, and says nothing about execute. The new
-- overload is a separate function with its own proacl, so the first file's
-- revoke does not reach it.

create or replace function public.promote_rider(
  p_user_id uuid,
  p_plan text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.profiles set plan = p_plan where id = p_user_id;
end;
$$;
