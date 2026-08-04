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
-- another. Every table this repository creates today - all 19 of them - has RLS
-- enabled with auth.uid() policies, and that is what makes granting the Data API
-- roles write access safe at all.
--
-- The `alter default privileges` block is what keeps this from having to be
-- repeated. It binds to the role running the migration, which is the same role
-- that creates the tables in every later migration, so anything added after
-- this file is exposed without another grant statement.
--
-- Read the sentence above about RLS as a statement of what is true now, not as a
-- standing guarantee. Nothing enforces it. A later migration that creates a table
-- and omits `enable row level security` still picks up the default privilege, and
-- an unauthenticated caller holding the public anon key can then select, insert,
-- update and delete every row in it. A migration adding a table must enable RLS
-- itself, the same way a migration adding a function must revoke execute itself.
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

-- Start from nothing for the two untrusted roles.
--
-- This revoke is not ceremony. With this file removed, a rebuilt stack still
-- shows `sessions` as `anon=Dxtm`: the CLI hands the Data API roles truncate,
-- references, trigger and maintain on its own and withholds only the four that
-- make a table readable, which is why the original failure read as "permission
-- denied for table sessions" rather than a table with no ACL at all. Granting a
-- narrower set on top of that leaves the wider one in place, so the platform's
-- privileges have to be taken away explicitly before ours are added. RLS does
-- not contain truncate.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;

-- anon gets no table access at all. Every unauthenticated write in the app goes
-- through the service client (the waitlist and invite routes), and no page reads
-- a table before sign-in: getTracks in lib/actions/tracks.ts returns early
-- without a user, and the demo browses fixtures rather than the database. A
-- future public read must grant itself what it needs, and will fail loudly
-- rather than silently inherit it.

-- service_role is the trusted server identity and bypasses RLS by design.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;

-- authenticated gets exactly what the application asks for, per table, derived
-- from every .from(...) call in app/, lib/ and components/ plus the writes the
-- `security invoker` RPCs perform as their caller.
--
-- profiles is SELECT ONLY, and that is the point of this block rather than a
-- detail of it. Postgres RLS chooses which ROW a policy admits; it cannot
-- restrict which COLUMN is written. So any UPDATE privilege on profiles lets a
-- user set tier, beta_access_expires_at and the Stripe identifiers on their own
-- row and grant themselves paid access. The one legitimate user-context write to
-- this table, the Stripe customer link, now runs through the admin client inside
-- an already authenticated server route (app/api/stripe/checkout/route.ts).
grant select on public.profiles to authenticated;

grant select, insert, update, delete on public.vehicles to authenticated;
grant select, insert, update, delete on public.tracks to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, update, delete on public.session_environment to authenticated;
grant select, insert, update, delete on public.session_changes to authenticated;
grant select, insert, update, delete on public.vehicle_baselines to authenticated;
grant select, insert, update, delete on public.sag_entries to authenticated;

-- Written by replace_session_laps, which is `security invoker` and so needs the
-- caller to hold these itself: it deletes and reinserts laps, and upserts the
-- matching telemetry summary.
grant select, insert, update, delete on public.session_laps to authenticated;
grant select, insert, update, delete on public.telemetry_summaries to authenticated;

-- save_session_outcome upserts feedback, upserts race engineer memory and marks
-- a recommendation, all as the caller.
grant select, insert, update, delete on public.session_feedback to authenticated;
grant select, insert, update on public.race_engineer_memory to authenticated;
grant select, update on public.ai_recommendations to authenticated;

grant select, insert, update on public.beta_feedback to authenticated;
grant select, insert on public.product_events to authenticated;

-- Deliberately absent for authenticated: ai_requests, beta_waitlist,
-- beta_invites and beta_rate_limits. Every one of those is reached only through
-- the service client, and beta_invites and beta_rate_limits back the invite and
-- rate-limit controls that create_beta_invite and consume_beta_rate_limit exist
-- to protect.

-- Future tables reach service_role automatically and the Data API roles never.
-- The revokes above already cleared anon and authenticated from the default ACL,
-- so a table added by a later migration arrives with no Data API access and the
-- migration that adds it grants what that table actually needs. Without this, one
-- new table silently reopens exactly the hole this file closes.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select, update on sequences to service_role;
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
