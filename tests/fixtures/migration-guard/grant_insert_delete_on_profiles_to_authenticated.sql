-- The other two writes. Deleting your own profiles row is a way to be re-created
-- by the signup trigger on the free tier; inserting one is a way to arrive
-- with any tier at all if the row was ever missing.

grant insert, delete on public.profiles to authenticated;
