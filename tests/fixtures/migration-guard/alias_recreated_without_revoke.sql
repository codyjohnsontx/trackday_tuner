-- Loaded after alias_created_with_revoke.sql. The drop names the function by
-- other spellings of its types and still removes it, so the function created
-- again here starts at execute to public and this file does not decide it.

drop function if exists public.cap_rider_sessions(uuid, int4, timestamptz, boolean, varchar);

create function public.cap_rider_sessions(
  p_user_id uuid,
  p_limit integer,
  p_since timestamp with time zone,
  p_active boolean,
  p_label character varying
)
returns integer
language sql
security invoker
set search_path = public
as $$
  select count(*)::integer from public.sessions where user_id = p_user_id;
$$;
