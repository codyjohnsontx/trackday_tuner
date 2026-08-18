-- The legitimate sequence, and the control that keeps the check honest.
--
-- Disabling a trigger around a bulk load and switching it back on afterwards is
-- ordinary, correct migration practice. The database this chain ends in has a
-- firing trigger, so the guard must stay quiet. Without this fixture the fix
-- could be "reject any disable" - which would be a guard that fails the correct
-- thing, and would get itself deleted the first time somebody needed a backfill.

alter table auth.users disable trigger on_auth_user_created;

insert into public.profiles (id, tier)
select id, 'free' from auth.users on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;
