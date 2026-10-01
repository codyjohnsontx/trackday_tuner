-- The take-back of a refused save's track checks every rider's sessions.
--
-- `delete_auto_created_track_if_unused` (20260930002400) is `security invoker`,
-- so its "does any session reference this track?" check ran under the caller's
-- RLS and saw only their own sessions. A rider's custom track is invisible to
-- everyone else, but the `sessions.track_id` foreign key does not know that, so
-- another rider's session can point at it - and the take-back then deleted the
-- track and `on delete set null` cleared that other rider's link (owner, on the
-- cross-rider finding: "A").
--
-- Only the check moves to `security definer`, as its own function, so it sees
-- every session. The take-back stays `security invoker`: it still locks and
-- deletes as the rider, so RLS and `auth.uid()` still decide which track it may
-- touch. The check is not a general lookup: it answers only for a track the
-- caller created and did not seed, and null for any other, so it cannot be used
-- to learn anything about a track that is not the caller's own. It runs with an
-- empty `search_path` and schema-qualified names, and only `authenticated` may
-- execute it, which the take-back needs because it calls the check as the
-- rider. `stable`, so it reads with the snapshot of the statement that calls
-- it, which the take-back issues after it holds the row lock.
--
-- The take-back's body changes to call it and to keep the track whenever the
-- check does not say "unreferenced". Its signature, security and grants are
-- unchanged.

create or replace function public.auto_created_track_is_referenced(p_track_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.tracks t
     where t.id = p_track_id
       and t.created_by = auth.uid()
       and not t.is_seeded
  ) then
    return null;
  end if;

  return exists (select 1 from public.sessions s where s.track_id = p_track_id);
end;
$$;

revoke all on function public.auto_created_track_is_referenced(uuid) from public, anon, authenticated;
grant execute on function public.auto_created_track_is_referenced(uuid) to authenticated;

create or replace function public.delete_auto_created_track_if_unused(p_track_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
     from public.tracks t
    where t.id = p_track_id
      and t.created_by = auth.uid()
      and not t.is_seeded
      for update;

  if not found then
    return false;
  end if;

  if public.auto_created_track_is_referenced(p_track_id) is not false then
    return false;
  end if;

  delete from public.tracks t
   where t.id = p_track_id
     and t.created_by = auth.uid()
     and not t.is_seeded;

  return true;
end;
$$;
