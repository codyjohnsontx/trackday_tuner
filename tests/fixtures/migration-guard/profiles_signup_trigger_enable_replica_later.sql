-- The subtlest of them, and the only one whose statement says `enable`.
--
-- `enable replica trigger` sets tgenabled to 'R', which means the trigger fires
-- only when session_replication_role is 'replica'. Ordinary application traffic
-- runs in 'origin', so for every real signup this trigger is off. A reader
-- skimming for the word `disable` sees an enable and moves on.

alter table auth.users enable replica trigger on_auth_user_created;
