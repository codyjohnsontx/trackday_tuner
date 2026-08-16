-- The same regression written without the word `trigger` anywhere.
--
-- `cascade` is not decoration here: Postgres refuses a plain `drop function` while
-- a trigger depends on it, so anyone removing the function reaches for cascade to
-- make the error go away, and cascade silently removes the dependent trigger
-- without naming it. The migration that installed the trigger is untouched and
-- still reads correctly, the function body containing the profiles insert is still
-- sitting in the earlier file, and the database the chain ends in has no writer.
--
-- A scan that recorded only `create trigger` and `drop trigger` kept the trigger
-- in its installed set, resolved the function to that earlier body, found the
-- insert, and reported nothing.

drop function public.handle_new_auth_user() cascade;
