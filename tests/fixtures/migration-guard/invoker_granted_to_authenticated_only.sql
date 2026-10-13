-- A creating migration that grants and still leaves the decision unmade. On a
-- function nobody has granted on yet, Postgres writes its default ACL in first
-- - execute to public - and adds authenticated beside it, so public can still
-- call it. Loaded before execute_decided_later.sql, whose revoke from public is
-- the decision; a database that never receives that file keeps the default.

create or replace function public.save_rider_note(
  p_session_id uuid,
  p_note text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.sessions set notes = p_note where id = p_session_id;
end;
$$;

grant execute on function public.save_rider_note(uuid, text)
  to authenticated;
