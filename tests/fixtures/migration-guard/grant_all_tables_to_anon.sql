-- A schema-wide table grant reaching anon carries profiles with it, whatever
-- the per-table statements say, and hands the role truncate on every table -
-- which RLS does not contain.

grant all on all tables in schema public to anon;
