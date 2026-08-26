-- The statement that shipped the hole, before 20260719001100 was rewritten to
-- grant per table. It names no table, so the diff never shows profiles.

grant all on all tables in schema public to authenticated, service_role;
