-- Creates cap_rider_sessions and says nothing about execute. Loaded before
-- alias_decided_later.sql, which decides it under other spellings of the same
-- argument types - the same function to Postgres, and the same deferral.

create or replace function public.cap_rider_sessions(
  p_user_id uuid,
  p_limit integer,
  p_since timestamp with time zone,
  p_active boolean,
  p_label character varying(40)
)
returns integer
language sql
security invoker
set search_path = public
as $$
  select count(*)::integer from public.sessions where user_id = p_user_id;
$$;
