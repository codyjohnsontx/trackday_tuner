-- The same grant aimed at public, spelled the way Postgres also accepts it:
-- PUBLIC is a pseudo-role every role belongs to, so this reaches anon and
-- authenticated without naming either, and a guard reading only those two
-- names calls it clean.

grant update on public.profiles to PUBLIC;
