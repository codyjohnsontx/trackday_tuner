-- The shape `create_beta_invite` and `consume_beta_rate_limit` already use, and
-- the one this guard asks for: the migration that creates the function is also
-- the migration that says who may call it.
--
-- The revoke is the part that matters. `grant execute ... to service_role` on
-- its own does not take public's built-in execute away.

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
  from public, anon, authenticated;
grant execute on function public.promote_rider(uuid)
  to service_role;
