-- The removal that removes nothing.
--
-- The trigger is still there. pg_trigger still has the row, the function still
-- has the insert, and every text scan looking for a `drop` finds none - but
-- tgenabled flips to 'D' and it stops firing, so new signups quietly stop getting
-- a profiles row. That is the original bug back, arriving through a statement
-- that never says drop.

alter table auth.users disable trigger on_auth_user_created;
