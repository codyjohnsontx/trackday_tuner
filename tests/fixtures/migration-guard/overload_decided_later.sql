-- The deferral on an overload, loaded after overload_without_revoke.sql. A
-- database holding that file and not this one has promote_rider(uuid, text)
-- executable by public, however the older promote_rider(uuid) was decided.

revoke all on function public.promote_rider(uuid, text)
  from public, anon, authenticated;
grant execute on function public.promote_rider(uuid, text)
  to service_role;
