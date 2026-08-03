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
-- another. Every table in public has RLS enabled with auth.uid() policies, which
-- is what makes granting the Data API roles write access safe at all.
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
-- The routines default privilege below therefore revokes rather than grants.
-- Treat that as a declaration of intent, not a guarantee. It is recorded in
-- pg_default_acl, but a function created afterwards on a rebuilt local stack
-- still comes out with a null proacl, which is Postgres's built-in execute to
-- public. The same statement against tables does take effect, so the mechanism
-- works and this one case does not. A new function is world-executable until
-- its own migration revokes it, exactly as create_beta_invite and
-- consume_beta_rate_limit already do.
--
-- Default privileges only apply to objects created after this statement, so no
-- function already defined by an earlier migration changes here.

grant usage on schema public to anon, authenticated, service_role;

-- The four the Data API actually uses, rather than `all`. `all` on a table also
-- carries truncate, references, trigger and maintain, none of which PostgREST
-- issues and none of which the app needs: the schema is built by migrations
-- running as the owner. For a sequence the three named here are the whole set,
-- so naming them changes nothing there beyond saying so out loud.
--
-- Do not read this as a narrower end state, because it was measured and it is
-- not. On a local stack with this file removed, `sessions` comes out as
-- `anon=Dxtm` - the CLI hands the Data API roles truncate, references, trigger
-- and maintain on its own, and withholds exactly the four that make a table
-- readable. That is why the failure this file fixes reads as "permission denied
-- for table sessions" rather than as a table with no ACL at all. Adding `arwd`
-- to a pre-existing `Dxtm` lands on `arwdDxtm` either way, so what this spelling
-- buys is an honest statement of what the application needs, not a smaller
-- privilege set.
grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;
grant usage, select, update on all sequences in schema public
  to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select, update on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  revoke execute on routines from public;

-- The two remaining RPC endpoints. Both are `security invoker`, so RLS already
-- contains them and this is not the load-bearing control that the revokes on
-- create_beta_invite and consume_beta_rate_limit are. It still takes anon off
-- functions no unauthenticated caller has any business reaching.
--
-- These belong here rather than in 20260716000800 and 20260422000400, which
-- define them: both are already recorded as applied on the hosted project, and
-- editing an applied migration changes the file without changing the database.
--
-- save_session_outcome is called by app/api/sessions/[id]/outcome/route.ts
-- through lib/supabase/server.ts, so its caller is `authenticated`.
-- record_race_engineer_memory_feedback has no caller in the application at all;
-- it takes p_user_id the same way save_session_outcome does, so it gets the same
-- role rather than a guess at a wider one.
--
-- set_updated_at is deliberately untouched: it returns `trigger`, so PostgREST
-- cannot expose it as an endpoint and it must stay callable by the triggers.
revoke execute on function public.save_session_outcome(
  uuid, uuid, uuid, uuid, text, smallint, text[], text, smallint
) from public, anon, authenticated;
grant execute on function public.save_session_outcome(
  uuid, uuid, uuid, uuid, text, smallint, text[], text, smallint
) to authenticated;

revoke execute on function public.record_race_engineer_memory_feedback(
  uuid, uuid, uuid, uuid, text, date, text, text[], text
) from public, anon, authenticated;
grant execute on function public.record_race_engineer_memory_feedback(
  uuid, uuid, uuid, uuid, text, date, text, text[], text
) to authenticated;
