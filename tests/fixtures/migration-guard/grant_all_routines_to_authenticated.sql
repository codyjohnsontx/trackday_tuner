-- A later migration handing execute on every existing function to `authenticated`,
-- undoing each per-function revoke written before it in one statement. The
-- functions are not re-listed anywhere, so nothing in the diff names what it
-- re-exposes.

grant execute on all routines in schema public to authenticated;
