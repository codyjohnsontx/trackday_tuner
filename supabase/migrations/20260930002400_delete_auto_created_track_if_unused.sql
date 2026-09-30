-- Take back a track a refused session save created, unless a session uses it.
--
-- A save that names a circuit the rider has never logged creates their own
-- `tracks` row first (lib/sessions/create.ts), because the session links to it,
-- and only then calls `create_session_with_laps`. When that call is refused, the
-- save takes the track back so a free rider does not lose a custom-track slot to
-- a session that was never stored. It did that with a plain delete, which is
-- wrong once a second save is involved: while one save paused between creating
-- the track and its write, another found that track by name and stored its
-- session against it, and the first save's refusal then deleted the track from
-- under that stored session. `sessions.track_id` is `on delete set null`, so the
-- delete succeeded and the winning session was left with a name and no track
-- (Codex review of PR 94; owner: "A").
--
-- This function is that delete, with the check it needs. It locks the track row
-- `for update` first, in a statement of its own. A session insert checks its
-- foreign key with `for key share` on that row, which conflicts, so a save that
-- is writing a session against the track makes this wait until it commits; the
-- check that follows is a new statement, so under read committed it sees that
-- session and the track stays. A save that arrives after the lock waits in turn,
-- and once this commits its foreign key fails and it is refused, stored nothing.
-- Only a track the caller created and did not seed can be taken, and only when no
-- session references it. It returns whether the track was deleted.
--
-- `security invoker`, like `delete_vehicle_if_sessions_unchanged`: RLS picks
-- which track and which sessions are visible, `auth.uid()` scopes the delete as
-- the `tracks` delete it replaces did, and `for update` needs the update
-- privilege `authenticated` holds on `tracks` (20260719001100).

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

  if exists (select 1 from public.sessions s where s.track_id = p_track_id) then
    return false;
  end if;

  delete from public.tracks t
   where t.id = p_track_id
     and t.created_by = auth.uid()
     and not t.is_seeded;

  return true;
end;
$$;

revoke all on function public.delete_auto_created_track_if_unused(uuid) from public, anon;
grant execute on function public.delete_auto_created_track_if_unused(uuid) to authenticated;
