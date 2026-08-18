-- A signup function whose body is a plain string literal rather than a
-- dollar-quoted one, and which does not write the profiles row.
--
-- Postgres accepts both spellings. Every migration and fixture here uses `$$`, so
-- this shape is latent rather than live - but it is what caught the guard reading
-- past the end of a declaration: with no dollar tag inside the statement it used
-- to search the rest of the file for one, so it either kept everything that
-- followed or sliced up to some later function's tag. Either way the
-- `insert into public.profiles` it went looking for could be found in a statement
-- this function never runs, and the guard would accept a signup path that writes
-- nothing.
--
-- The insert below is deliberately placed *after* the function, in an unrelated
-- statement, so a scan that reads past the terminator finds it and a scan that
-- stops at the terminator does not.

create function public.handle_new_auth_user() returns trigger as 'begin return new; end' language plpgsql security definer;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

insert into public.profiles (id, tier)
select id, 'free' from auth.users on conflict (id) do nothing;
