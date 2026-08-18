-- The same removal as profiles_signup_trigger_dropped_later.sql, spelled with a
-- different case.
--
-- Postgres folds an unquoted identifier to lower case, so this drops the trigger
-- created as `on_auth_user_created` - they are one object, not two. A guard that
-- keys its bookkeeping on the identifier as written sees a drop of some other
-- trigger, keeps the real one in its installed set, resolves the still-present
-- function body, finds the insert, and reports nothing.
--
-- That is a guard defeated by spelling, which is the same class of defect as
-- everything else this file exists to catch.

drop trigger On_Auth_User_Created on auth.users;
