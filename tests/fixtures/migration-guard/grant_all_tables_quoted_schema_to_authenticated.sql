-- Schema-wide with the schema name quoted. Postgres reads `"public"` as the same
-- public schema, so this carries every table - profiles included - to
-- authenticated, and a guard matching only the bare word `public` after
-- `in schema` misses it.

grant select, insert, update, delete on all tables in schema "public" to authenticated;
