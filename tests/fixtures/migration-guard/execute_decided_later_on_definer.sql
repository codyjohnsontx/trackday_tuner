-- The deferral on a `security definer` function, loaded after
-- definer_without_revoke.sql. The definer check already names the creating file;
-- the deferral check names this one too, because it is the file whoever applies
-- the first by hand has to know about.

revoke all on function public.promote_rider(uuid)
  from public, anon, authenticated;
