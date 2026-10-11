-- Decides execute on cap_rider_sessions in a later migration, naming its types
-- by other spellings: int4 for integer, timestamptz for timestamp with time
-- zone, bool for boolean, varchar for character varying, and a qualified uuid.

revoke all on function public.cap_rider_sessions(pg_catalog.uuid, int4, timestamptz, bool, varchar)
  from public, anon, authenticated;
grant execute on function public.cap_rider_sessions(uuid, int4, timestamptz, bool, varchar)
  to authenticated;
