-- The default privilege the first draft of 20260719001100 carried. It would
-- have swept up a profiles table recreated or altered by any later migration.

alter default privileges in schema public
  grant all on tables to authenticated;
