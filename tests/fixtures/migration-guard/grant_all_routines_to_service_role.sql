-- Not a violation, and the reason the role list is three names rather than "any
-- role at all".
--
-- `service_role` is the key that never leaves the server and already bypasses RLS
-- on every table. Granting execute to it re-exposes nothing an attacker can reach
-- with the anon key, which is the threat the per-function revokes exist for. A
-- guard that failed this would be blocking work that is fine, and a guard that
-- blocks work that is fine gets switched off.

grant execute on all routines in schema public to service_role;

alter default privileges in schema public
  grant execute on routines to service_role;
