-- An external sign-in whose provider has not verified the email address never
-- joins an account that already exists, and never starts one either.
--
-- GoTrue links a new provider identity into an existing user by email address.
-- It is meant to do that only for an address the provider vouches for, and its
-- own linking rule (DetermineAccountLinking in internal/models/linking.go, read
-- at v2.193.0, the version the local stack runs) says so - except that it also
-- counts every address as verified whenever "Confirm email" is off:
--
--   if email.Verified || config.Mailer.Autoconfirm {
--
-- supabase/config.toml has `enable_confirmations = false`, which is
-- Mailer.Autoconfirm, and the hosted setting is not something this repository
-- can see. With it off, a Google sign-in asserting `email_verified: false` for a
-- rider's address is linked into that rider's account and handed a session on it.
-- Measured, not read off the source alone: against a local stack whose Google
-- provider was pointed at a stub issuer, an account created with a confirmed
-- email and a password was taken over by exactly that sign-in - same user id,
-- providers ["email", "google"], a full session. Consumer Gmail always asserts
-- `email_verified: true`; a Google Workspace domain whose admin creates the
-- mailbox can assert false, which is the standard takeover vector for "Sign in
-- with Google". Owner decision 2026-10-04: gate it.
--
-- WHY A TRIGGER RATHER THAN THE SETTING ALONE
--
-- Turning "Confirm email" on closes this inside GoTrue (the unverified sign-in
-- then gets a new, separate account instead), and docs/beta-runbook.md says so.
-- But it also changes ordinary email signup, it is off in local development on
-- purpose, and one toggle in a dashboard is not a gate anyone can see from here.
-- The identity insert is the one point every linking path passes through - the
-- OAuth callback, an ID-token sign-in, and any provider added later - so the
-- gate sits there and holds whatever the setting says.
--
-- WHAT IT REFUSES, EXACTLY
--
-- Any new identity for an external provider (anything but `email` and `phone`;
-- `sso:` providers never link by email, GoTrue keeps each in its own domain)
-- whose `identity_data.email_verified` is not true - whether it would join an
-- existing user or be the first identity of a brand-new one. An absent claim
-- counts as unverified, so a provider that sends none fails closed. Accepted as
-- `true` are the JSON boolean and the string "true", since Apple sends the claim
-- as a string. Email and password signup is untouched.
--
-- The first identity is refused too because the takeover also runs in the
-- other order. An unverified sign-in for an address nobody has registered yet
-- would create an account holding that address; when its real owner later signs
-- in with a verified identity, GoTrue links them into it - the account the
-- unverified sign-in made - and both share it. Refusing the unverified identity
-- outright means no account ever holds an address its provider did not vouch
-- for.
--
-- The refusal is an exception, so GoTrue rolls back the whole sign-in: no
-- identity, no session, no new user, and any existing account is exactly as it
-- was. The sign-in reaches the app's /auth/callback with no code and
-- `error_description=Error creating identity`, which it answers with
-- `/login?error=provider_email_unverified`.
--
-- Manual linking (`linkIdentity`, a signed-in rider adding a provider to their
-- own account) is refused the same way when the provider's claim is unverified.
-- It is `enable_manual_linking = false` and nothing in the app calls it today.

create or replace function public.refuse_unverified_identity_link()
returns trigger
language plpgsql
security invoker
-- It reads only the row being inserted, so it runs as whoever fires it -
-- supabase_auth_admin, the role GoTrue writes auth tables as. search_path is
-- pinned empty all the same.
set search_path = ''
as $$
begin
  if new.provider in ('email', 'phone') or new.provider like 'sso:%' then
    return new;
  end if;

  if lower(coalesce(new.identity_data ->> 'email_verified', '')) = 'true' then
    return new;
  end if;

  raise exception 'refusing an unverified % email', new.provider
    using errcode = 'TT403',
          hint = 'The provider did not verify this email address; sign up or sign in with email and password instead.';
end;
$$;

-- Not callable by anyone but the trigger. `public` is named because anon and
-- authenticated are members of it (CLAUDE.md, "Database Migrations").
revoke all on function public.refuse_unverified_identity_link() from public, anon, authenticated;

drop trigger if exists refuse_unverified_identity_link on auth.identities;
create trigger refuse_unverified_identity_link
  before insert on auth.identities
  for each row execute function public.refuse_unverified_identity_link();
