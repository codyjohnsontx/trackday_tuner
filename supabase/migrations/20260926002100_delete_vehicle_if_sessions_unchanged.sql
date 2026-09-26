-- Delete a bike only while its sessions are exactly the ones the caller read.
--
-- Owner's decision of 2026-09-26 on session photos: a photo is removed from the
-- public session-photos bucket BEFORE its row is deleted, and a row whose photo
-- storage did not confirm removing is kept, so a deleted session can never leave
-- its photo online. Deleting a bike cascades to every session on it, so
-- lib/actions/vehicles.ts reads the bike's sessions, removes their photos, and
-- then deletes the bike. Between that read and the delete a phone can sync a new
-- session, or a new photo onto an existing one. A plain delete would cascade that
-- session and orphan a photo nobody removed. This function is the delete, with
-- the re-check inside it.
--
-- It locks the vehicle row `for update` first. A session insert checks its
-- foreign key with `for key share` on that row, which conflicts, so no session
-- can be added to the bike until this transaction ends - and once it ends the
-- bike is gone and that insert fails its foreign key. It then locks the bike's
-- existing sessions, so a `photo_url` update waits the same way. With both locked
-- it compares the sessions, as (id, photo_url) pairs, against
-- `p_expected_sessions` - the pairs the caller read and removed photos for - and
-- raises `TT409` on any difference in either direction. The caller answers that
-- with the reload message the confirmation already has, and the bike stays.
--
-- `security invoker`: it runs as the rider, so RLS still picks which vehicle and
-- which sessions are visible, and `auth.uid()` scopes the delete exactly as the
-- `vehicles` delete it replaces did. `for update` needs update privilege, which
-- `authenticated` holds on both tables (20260719001100). It returns the deleted
-- vehicle's id and `photo_url` (the bike's own photo is still removed after the
-- delete, as before), or null when no vehicle of the caller's has that id.

create or replace function public.delete_vehicle_if_sessions_unchanged(
  p_vehicle_id uuid,
  p_expected_sessions jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_photo_url text;
begin
  if jsonb_typeof(p_expected_sessions) is distinct from 'array' then
    raise exception 'p_expected_sessions must be an array' using errcode = '22023';
  end if;

  select v.photo_url
    into v_photo_url
    from public.vehicles v
   where v.id = p_vehicle_id
     and v.user_id = auth.uid()
     for update;

  if not found then
    return null;
  end if;

  perform 1
     from public.sessions s
    where s.vehicle_id = p_vehicle_id
      for update;

  if exists (
    (select s.id::text, s.photo_url
       from public.sessions s
      where s.vehicle_id = p_vehicle_id
     except
     select e ->> 'id', e ->> 'photo_url'
       from jsonb_array_elements(p_expected_sessions) e)
    union all
    (select e ->> 'id', e ->> 'photo_url'
       from jsonb_array_elements(p_expected_sessions) e
     except
     select s.id::text, s.photo_url
       from public.sessions s
      where s.vehicle_id = p_vehicle_id)
  ) then
    raise exception 'the sessions on this vehicle changed since they were read'
      using errcode = 'TT409';
  end if;

  delete from public.vehicles
   where id = p_vehicle_id
     and user_id = auth.uid();

  return jsonb_build_object('id', p_vehicle_id, 'photo_url', v_photo_url);
end;
$$;

revoke all on function public.delete_vehicle_if_sessions_unchanged(uuid, jsonb) from public, anon;
grant execute on function public.delete_vehicle_if_sessions_unchanged(uuid, jsonb) to authenticated;
