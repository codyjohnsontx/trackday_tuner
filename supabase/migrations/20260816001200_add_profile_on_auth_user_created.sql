-- Every auth user gets a profiles row, whichever door they came in through.
--
-- Until this migration public.profiles had exactly one writer: the beta signup
-- route (app/api/beta/signup/route.ts), which inserts through the service-role
-- client after redeeming an invite. Every rider so far arrived that way, so every
-- rider had a row and the gap stayed invisible. 20260223000000 says so outright.
--
-- It stops being invisible on the paid path. app/api/stripe/checkout/route.ts
-- attaches the Stripe customer by updating profiles, and correctly treats a
-- missing row as fatal *before* charging: it deletes the customer it just created
-- and returns "Unable to link your billing account. Please try again." A rider
-- with no row gets that answer forever - someone who wants to pay and cannot.
--
-- Measured, not reasoned about. Against a local stack with BETA_INVITE_ONLY=false,
-- signing up through the ordinary form produced an auth.users row and zero
-- profiles rows, and Upgrade to Pro returned 500 with exactly that message.
-- Inserting the row by hand made the identical request return 200 and link the
-- customer, which is what isolates the missing row as the cause rather than
-- anything else on that route.
--
-- WHY A TRIGGER RATHER THAN APPLICATION CODE
--
-- The app is not in the signup path at all for the case that matters.
-- components/auth/auth-form.tsx calls supabase.auth.signUp() from the browser
-- straight to GoTrue once invite-only is off, and an OAuth signup is GoTrue
-- talking to the provider; neither reaches a route handler before the account
-- exists, so no route handler can be the choke point. The only app-side place
-- that sees every one of those riders is getRealUser() in lib/auth.ts, on the
-- read path of every authenticated page - which would put a write attempt on
-- every render, and would have to make it with the admin client, because
-- `authenticated` deliberately holds no INSERT on profiles (see the grant notes
-- in 20260719001100 and CLAUDE.md: RLS gates rows, not columns, so that
-- privilege is withheld on purpose and no policy could give it back safely).
--
-- A trigger sits where the account is actually created, which is the single point
-- all of those paths already pass through, and it cannot be bypassed by a signup
-- path nobody has written yet. The cost is that it lives in a schema the app does
-- not own and is easy to miss when reading the app; that is what this comment,
-- the note in CLAUDE.md, and the guard in tests/unit/migrations-bootstrap.test.ts
-- are for.
--
-- The insert is deliberately not wrapped in an exception handler. Swallowing a
-- failure would let signup succeed with no profiles row, which is precisely the
-- state this exists to prevent, and it would do it silently.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
-- security definer runs this as its owner, so search_path is pinned empty and
-- every name below is schema-qualified. The privilege is required rather than
-- convenient: the trigger fires as supabase_auth_admin, the role GoTrue inserts
-- auth.users as, which holds nothing on public.profiles.
set search_path = ''
as $$
begin
  -- `do nothing` so a row that already exists is never clobbered. Nothing writes
  -- profiles before the auth user exists today, but the beta signup route upserts
  -- its cohort and access window onto this row moments later, and losing that to a
  -- replayed insert would be worse than the gap this closes.
  insert into public.profiles (id, tier)
  values (new.id, 'free')
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Not callable by anyone but the trigger. A trigger function's execute privilege
-- is checked when the trigger is created, not each time it fires, so revoking
-- here does not stop it firing - it stops an unauthenticated PostgREST caller
-- invoking a security definer function directly. `public` is named because anon
-- and authenticated are members of it, so revoking only those two would leave the
-- function reachable. See the note on this in CLAUDE.md.
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
