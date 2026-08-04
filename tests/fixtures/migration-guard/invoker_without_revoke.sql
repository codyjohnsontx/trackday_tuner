-- Not a violation, and the reason the check is scoped to `security definer`.
--
-- A `security invoker` function runs as its caller, so every RLS policy on every
-- table it touches still applies. Being executable by anon buys an attacker
-- nothing they could not do by querying the tables directly. Three functions in
-- supabase/migrations are exactly this shape and only one of them revokes, so a
-- guard covering them would fail the repository on day one and get deleted.

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
