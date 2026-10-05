-- The control: the creating migration decides execute on cap_rider_sessions,
-- spelling its types differently from the create statement. Postgres reads
-- both as the one function, so it is decided where it is made.

create or replace function public.cap_rider_sessions(
  p_user_id uuid,
  p_limit int,
  p_since timestamptz,
  p_active bool,
  p_label varchar(40)
)
returns integer
language sql
security invoker
set search_path = public
as $$
  select count(*)::integer from public.sessions where user_id = p_user_id;
$$;

revoke all on function public.cap_rider_sessions(pg_catalog.uuid, integer, timestamp with time zone, boolean, character varying)
  from public, anon, authenticated;
