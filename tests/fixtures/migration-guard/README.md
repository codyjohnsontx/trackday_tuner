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

Seventeen cover the entitlement-write check: the escalation where a rider holding
UPDATE on `profiles` sets their own `tier`, beta access and Stripe identifiers,
which RLS cannot stop because it picks the row and not the column. Nine are the
same three roles across the three shapes a write can arrive in -
`grant_update_on_profiles_to_*.sql` per table, `grant_all_tables_to_*.sql`
schema-wide and `default_privileges_tables_to_*.sql` aimed at every future
table - and between them the pseudo-role is written `PUBLIC` and bare `public`,
because Postgres folds the two to one role and a guard reading only one spelling
is evadable by recasing. The guard reads it quoted as well; the quoted spelling
is exercised on identifiers rather than the grantee, because that is where it
actually walked past a guard.
`grant_update_on_unqualified_profiles_to_authenticated.sql` and
`grant_update_on_quoted_profiles_to_authenticated.sql` respell the table
instead of the role - a bare `profiles`, which search_path puts in public, and
`"public"."profiles"`, which is the same identifier quoted - because the guard
once read only `public.profiles` and either spelling walked past it.
`grant_update_on_profiles_in_list_to_authenticated.sql` buries `profiles` in a
multi-table grant list, `public.profiles, public.vehicles`, because the guard
once read `profiles` only when it sat alone immediately before `to`.
`grant_all_tables_quoted_schema_to_authenticated.sql` is the schema-wide grant
with the schema name quoted, `in schema "public"`, which the guard's
schema-wide arm once required bare.
`grant_all_tables_multi_schema_to_authenticated.sql` puts `public` in a
multi-schema list, `in schema private, public`, which the schema-wide arm
once read only when `public` was the sole schema before `to`.
`grant_column_update_on_profiles_to_authenticated.sql` is the narrow-looking
`grant update (tier)`, which reopens exactly the column the check exists to
close; `grant_insert_delete_on_profiles_to_authenticated.sql` is the other two
writes. `grant_select_on_profiles_to_authenticated.sql` is the control: the one
privilege a rider needs on that table, and what `20260719001100` grants, so the
guard has to stay quiet about it. Those fixtures read as text; the same
escalation sent at a real database is `tests/e2e/profile-entitlement-columns.spec.ts`.

Fifteen cover the profiles-writer check rather than execute.
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

The other twelve are that check judging the **final** state of an ordered list of
migrations rather than the first file in it that installs a trigger.
`profiles_signup_trigger_installed.sql` is the schema as `20260816001200` leaves
it, correct on its own, and is loaded ahead of each of the nine regressions:
`profiles_signup_trigger_dropped_later.sql` drops the trigger and puts nothing
back, `profiles_signup_trigger_repointed_later.sql` keeps the trigger under the
same name and points it at a function that writes something else,
`profiles_signup_function_replaced_later.sql` leaves the trigger entirely alone
and `create or replace`s the function body out from under it, and
`profiles_signup_function_dropped_cascade_later.sql` writes the removal without the
word `trigger` anywhere - Postgres refuses a plain `drop function` while a trigger
depends on it, so cascade is what anyone removing it actually reaches for, and
cascade takes the dependent trigger silently.
`profiles_signup_trigger_dropped_case_variant_later.sql` is the plain drop again
with the identifier spelled `On_Auth_User_Created`: Postgres folds unquoted names,
so that is the same trigger, and a guard keying its bookkeeping on the name as
written was evadable by changing the spelling. All five arrive in a later file
because CLAUDE.md sends every correction to a new migration, which is what makes
them the realistic shape of this regression and not a contrived one. The guard used
to pass all five.

Four more silence the trigger instead of removing it, which is the same outcome
reached without a `drop` anywhere: `profiles_signup_trigger_disabled_later.sql`
names it, `profiles_signup_trigger_disabled_all_later.sql` and
`profiles_signup_trigger_disabled_user_later.sql` reach it through
`disable trigger all` and `disable trigger user`, and
`profiles_signup_trigger_enable_replica_later.sql` is the one whose statement says
`enable` - `enable replica trigger` fires only when `session_replication_role` is
`replica`, so it is off for every ordinary signup. The row stays in `pg_trigger`
and the function keeps its insert through all four, which is why a scan reading
only `create` and `drop` called them clean.

`profiles_signup_trigger_disabled_then_reenabled_later.sql` is the control for
those: disabling around a bulk load and switching it back on is ordinary
migration practice, and the guard must stay quiet about it. Without that fixture
the fix could have been "reject any disable", which fails correct work and gets
itself deleted the first time somebody needs a backfill.

`profiles_signup_function_dropped_without_cascade_later.sql` is the second fixture
the guard is meant to stay **quiet** about. `drop function` defaults to
`restrict`, so Postgres refuses it while a trigger depends on the function: the
statement errors and both objects survive. Reporting that as a removal would
describe a database that cannot exist, and staying quiet costs nothing, because a
migration that really does take the trigger away has to write `drop trigger`
first.

Two more vary how the same function is written rather than which role it names:
`definer_attributes_after_body.sql` puts `security definer` after the body, which
Postgres accepts because its option list is order-independent, and
`definer_unqualified_name.sql` leaves off the `public.` qualifier, which
search_path supplies. Both ship the identical world-executable function, so the
guard has to read both.
