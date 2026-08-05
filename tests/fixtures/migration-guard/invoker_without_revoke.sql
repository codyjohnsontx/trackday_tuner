-- Not a violation, and the reason the check is scoped to `security definer`.
--
-- A `security invoker` function runs as its caller, so every RLS policy on every
-- table it touches still applies. Being executable by anon buys an attacker
-- nothing they could not do by querying the tables directly.
--
-- 20260719001100 now revokes execute on the client-callable invoker functions
-- anyway, so this is no longer the difference between passing and failing the
-- whole repository. It is still out of scope for two reasons: `set_updated_at`
-- has no revoke and needs none, being reached through triggers rather than
-- called by a client, and two of those revokes live in a later migration than
-- the one creating the function, which the same-migration rule would flag.

create or replace function public.save_rider_note(
  p_session_id uuid,
  p_note text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.sessions set notes = p_note where id = p_session_id;
end;
$$;
