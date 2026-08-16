-- A later migration that takes the writer away and puts nothing back.
--
-- This is the plainest form of the regression, and the one a guard reading only
-- the first migration that installs a trigger never sees at all: the file that
-- installed it is untouched and still reads correctly, while the schema the chain
-- ends in has no writer for public.profiles. CLAUDE.md sends every correction to
-- a new migration, so arriving in a later file is the ordinary case rather than a
-- contrived one.

drop trigger on_auth_user_created on auth.users;
