-- The same reversal aimed forward instead of backward: every function created
-- after this statement comes out executable by `anon`, including ones whose
-- migrations have not been written yet. It also overwrites the routines default
-- privilege 20260719001100 set, which revokes from public.

alter default privileges in schema public
  grant execute on routines to anon;
