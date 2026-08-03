-- Make the schema visible to the roles the application actually connects as.
--
-- Nothing in this repository ever granted anything to anon, authenticated or
-- service_role. The hosted project never noticed because it predates the change
-- and still carries Supabase's legacy default privileges, which auto-granted
-- every new object in public. A project created today does not: see the
-- `auto_expose_new_tables` note in supabase/config.toml. Without these grants a
-- fresh database applies every migration cleanly and then answers every
-- PostgREST request with "permission denied for table ..." - the tables exist
-- and the app is blind to them.
--
-- Row Level Security, not the grant, is what keeps one rider's rows away from
-- another. Every table in public has RLS enabled with auth.uid() policies, so
-- granting broadly here reproduces the privileges the hosted project already
-- has rather than tightening them behind its back.
--
-- The `alter default privileges` block is what keeps this from having to be
-- repeated. It binds to the role running the migration, which is the same role
-- that creates the tables in every later migration, so anything added after
-- this file is exposed without another grant statement.

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on routines to anon, authenticated, service_role;
