-- The bug this guard exists to catch: a `security definer` function shipped with
-- no statement anywhere in its own migration deciding who may execute it.
--
-- Postgres leaves proacl null on a function nobody has granted or revoked, and a
-- null proacl means execute to public. The routines default privilege in
-- 20260719001100 does not reach it. So this function is callable over PostgREST
-- by an unauthenticated caller holding the anon key, and it runs as its owner,
-- which is exactly what `security definer` means: it bypasses every RLS policy.

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
