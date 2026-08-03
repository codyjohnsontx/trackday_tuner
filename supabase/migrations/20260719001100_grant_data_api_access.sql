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
--
-- Functions are the exception, and deliberately so: nothing here grants execute
-- schema-wide. A function is not contained by RLS the way a table is - a
-- `security definer` function runs as its owner and bypasses every policy, so
-- for those the grant *is* the access control. `create_beta_invite` and
-- `consume_beta_rate_limit` (20260718001000) are exactly that shape: both revoke
-- execute from public, anon and authenticated and grant it only to service_role,
-- and a `grant ... on all routines` here would run after them and hand an
-- unauthenticated caller holding the public anon key a working POST to
-- /rest/v1/rpc/create_beta_invite. Execute stays the business of the migration
-- that creates the function, which is where its caller is known.
--
-- The routines default privilege therefore revokes rather than grants, so a
-- function added later is not anon-callable merely by existing. Default
-- privileges only apply to objects created after this statement, so no function
-- already defined by an earlier migration changes here.

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  revoke execute on routines from public;
