-- How an author declares that a `security definer` function is meant to be
-- callable by anyone. The guard asks for an explicit decision, not for every
-- function to be locked, so this passes.
--
-- Naming `public` in a `grant execute on function` is the declaration. It is the
-- same privilege a forgotten revoke leaves behind, with the difference that
-- someone wrote it down and a reviewer can see it in the diff.

create or replace function public.track_count()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return (select count(*) from public.tracks);
end;
$$;

grant execute on function public.track_count() to public;
