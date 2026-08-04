-- The other half of definer_unqualified_name.sql: an author who leaves the
-- qualifier off both statements has still written the decision down, and reading
-- the create without the revoke would fail them for nothing.
--
-- Both statements name the same function, and Postgres resolves both through
-- search_path to public.promote_rider.

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

revoke all on function promote_rider(uuid)
  from public, anon, authenticated;
grant execute on function promote_rider(uuid)
  to service_role;
