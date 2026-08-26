-- The same escalation as grant_update_on_profiles_to_authenticated.sql with the
-- schema and table quoted. Postgres reads "public"."profiles" as the identical
-- identifier, so a guard keyed on the bare spelling was evadable by quoting.

grant update on "public"."profiles" to authenticated;
