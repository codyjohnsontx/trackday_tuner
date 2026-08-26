-- The same escalation as grant_update_on_profiles_to_authenticated.sql with the
-- table named without its schema. search_path puts an unqualified `profiles`
-- in public, so this reaches the same table and the same columns.

grant update on profiles to authenticated;
