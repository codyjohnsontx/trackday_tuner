-- Schema-wide to the pseudo-role, quoted. Postgres reads "public" as the same
-- PUBLIC, so this is the widest spelling of all and the one a scan for the two
-- role names misses entirely.

grant select, insert, update, delete on all tables in schema public to "public";
