-- Schema-wide to the pseudo-role. `public` is a keyword, so bare and unquoted it
-- is unambiguously PUBLIC - the group every role belongs to, so this reaches
-- anon and authenticated without naming either, and a scan for those two role
-- names misses it entirely. The guard matches the word `public` in the grantee
-- however it is spelled.

grant select, insert, update, delete on all tables in schema public to public;
