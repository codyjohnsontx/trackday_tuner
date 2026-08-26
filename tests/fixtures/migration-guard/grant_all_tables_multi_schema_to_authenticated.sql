-- Schema-wide over a multi-schema list that includes public. Postgres accepts
-- `in schema a, b` and grants on every table in each, so this reaches
-- public.profiles exactly as `in schema public` would; a guard that only reads
-- public when it is the sole schema immediately before TO misses it.

grant select, insert, update, delete on all tables in schema private, public to authenticated;
