# migration-guard fixtures

SQL that is deliberately wrong, and SQL that is deliberately right, fed to the
analysis in `tests/unit/migrations-bootstrap.test.ts` as if it were a migration.

These files are **not** migrations. They live outside `supabase/migrations/` so
`supabase start`, `supabase db push` and `npm run db:status` never see them. The
guard's own tests are the only thing that reads them.

A fixture exists so the guard can be watched failing. The migrations already get
this right: `20260718001000_add_beta_foundation.sql` carries a correct `revoke` /
`grant execute` pair on both of the repository's `security definer` functions,
`create_beta_invite` and `consume_beta_rate_limit`, and
`20260717000900_add_session_laps.sql` carries one on `replace_session_laps`. So
running the guard only against the real migrations proves nothing about what it
would do to a migration that got it wrong. It would pass just as happily if the
check were deleted.

Each filename says what it is. The three role spellings - `anon`,
`authenticated` and `public` - are covered separately because `public` is the
one the real migrations revoke from, and the one the guard used to miss.

Eight cover the profiles-writer check rather than execute.
`profiles_without_signup_trigger.sql` is the repository as it stood before
`20260816001200`: a profiles table keyed to `auth.users` that nothing ever
inserts into. Every statement in it applies cleanly, which is the point - the gap
was invisible until a rider tried to subscribe.
`signup_trigger_without_profile_insert.sql` attaches a trigger in the right place
whose function writes an analytics row instead, so a guard checking only that
*some* after-insert trigger exists would pass it.

`profiles_signup_function_not_dollar_quoted.sql` writes the signup function's body
as a plain string literal instead of `$$ ... $$` and puts an unrelated
`insert into public.profiles` further down the file, so a guard that searched the
whole remainder for a dollar tag read past the declaration and found an insert the
function never runs. Every real migration uses `$$`, so it is latent - the fixture
exists because the guard reading unrelated SQL is the failure it exists to prevent.

The other five are that check judging the **final** state of an ordered list of
migrations rather than the first file in it that installs a trigger.
`profiles_signup_trigger_installed.sql` is the schema as `20260816001200` leaves
it, correct on its own, and is loaded ahead of each of the four regressions:
`profiles_signup_trigger_dropped_later.sql` drops the trigger and puts nothing
back, `profiles_signup_trigger_repointed_later.sql` keeps the trigger under the
same name and points it at a function that writes something else,
`profiles_signup_function_replaced_later.sql` leaves the trigger entirely alone
and `create or replace`s the function body out from under it, and
`profiles_signup_function_dropped_cascade_later.sql` writes the removal without the
word `trigger` anywhere - Postgres refuses a plain `drop function` while a trigger
depends on it, so cascade is what anyone removing it actually reaches for, and
cascade takes the dependent trigger silently. All four arrive in a later file
because CLAUDE.md sends every correction to a new migration, which is what makes
them the realistic shape of this regression and not a contrived one. The guard used
to pass all four.

Two more vary how the same function is written rather than which role it names:
`definer_attributes_after_body.sql` puts `security definer` after the body, which
Postgres accepts because its option list is order-independent, and
`definer_unqualified_name.sql` leaves off the `public.` qualifier, which
search_path supplies. Both ship the identical world-executable function, so the
guard has to read both.
