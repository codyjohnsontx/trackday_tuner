-- The control for the cascade requirement, and the only fixture here that is
-- wrong SQL the guard is meant to stay quiet about.
--
-- `drop function` defaults to `restrict`, and Postgres refuses a restricted drop
-- while a trigger depends on the function. This statement errors; the function and
-- the trigger both survive. Reporting it as "leaves public.profiles with no
-- writer" would be describing a database that cannot exist.
--
-- Staying quiet costs no coverage. A migration that really does take the trigger
-- away has to drop the trigger first, and that `drop trigger` is caught by its own
-- arm of the matcher - see profiles_signup_trigger_dropped_later.sql.

drop function public.handle_new_auth_user();
