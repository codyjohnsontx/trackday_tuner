-- Link sessions that name a circuit but point at no track row to the track that
-- name resolves to today, by the rules a new save resolves it by.
--
-- HOW A SESSION ENDS UP WITH A NAME AND NO TRACK
--
-- `sessions.track_id` is nullable and `track_name` is kept beside it, so every
-- one of these leaves a session that reads as a circuit and groups as none:
--
-- 1. Saved before the circuit had a row. Nothing seeded `tracks` until
--    20260916001600, so a session naming Road America before then either made
--    the rider's own row or, when it could not, saved the name alone.
-- 2. Saved when the track row could not be made. `resolveSessionTrack`
--    (lib/sessions/create.ts) saves the name alone at the free-plan custom-track
--    cap, on an insert error, and when the name lookup could not answer.
-- 3. Its track was deleted. `track_id` is `on delete set null`, so deleting a
--    custom track leaves its sessions holding the name.
-- 4. Written straight to the table. `authenticated` holds insert and update on
--    `sessions`, so a client that never went through the resolver could store a
--    name with no id.
--
-- Comparisons pair two sessions by `track_id` when both carry one and by the
-- folded name otherwise (`sessionsMatchTrack`, lib/session-compare.ts), and the
-- track page lists a track's sessions by id, so each of these is missing from
-- the circuit's own history and from every track-scoped read.
--
-- THE RULES ARE lib/track-lookup.ts's, WRITTEN IN SQL
--
-- `findVisibleTrackByName`, then `findVisibleTrackByAlias`, in the scope the
-- session's own rider sees (`visibleTracksFilter`: seeded, or created by them):
--
--   - names are equal when `trackNameKey` folds them equal - NFC, runs of
--     whitespace collapsed, trimmed, lowercased. The whitespace class is
--     JavaScript's `\s` spelled out, because Postgres's `\s` leaves U+FEFF out;
--   - the rider's own track wins over a seeded one of the same name (the
--     current precedence; ADR 0001 decision 8 reverses it and is not built);
--   - an alias is consulted only when no name matched.
--
-- One deliberate difference: where the resolver takes the first of two rows at
-- the same precedence - two custom tracks of the rider's own that fold to one
-- name - this takes NEITHER. A save picks for the rider in front of the form;
-- a backfill picking for a rider who is not there would be a guess, so the row
-- is left alone and reported as `ambiguous` with the candidates.
--
-- WHAT IT DOES NOT DO
--
-- It creates no track: a name matching nothing is reported `unmatched` and left
-- as it is, since a row made here would spend a free rider's custom-track slot
-- they never chose to spend. It never changes a session that already has a
-- track. And it leaves `track_name` as stored - a save overwrites that with the
-- track's own name, which ADR 0001 records as a defect (the typed name is meant
-- to be kept), and a backfill should not widen it to rows written before.
-- `layout_id` stays null: a session with no track cannot hold a layout
-- (`sessions_check_layout`), and which layout an old session ran is not
-- something its name says.
--
-- WHY A FUNCTION
--
-- The relink is re-runnable rather than a one-off: causes 2 to 4 above keep
-- producing rows, and a track a rider adds later can match a name that matched
-- nothing today. A function lets the operator run it again and read back what
-- it did, one row per session it looked at, and lets tests/db call it scoped to
-- one rider. It is idempotent - a relinked session has a track and is not looked
-- at again - so a second run changes nothing the first did. Execute belongs to
-- service_role alone: it writes across every rider, which no Data API role may.
-- `security invoker`, so it runs as its caller and needs no definer privileges.

create or replace function public.relink_legacy_session_tracks(p_user_id uuid default null)
returns table (
  session_id uuid,
  user_id uuid,
  track_name text,
  outcome text,
  track_id uuid,
  candidate_track_ids uuid[]
)
language sql
volatile
security invoker
set search_path = ''
as $$
  with legacy as (
    select s.id, s.user_id, s.track_name,
           lower(btrim(regexp_replace(normalize(s.track_name, NFC),
             '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'))) as name_key
      from public.sessions s
     where s.track_id is null
       and (p_user_id is null or s.user_id = p_user_id)
  ),
  named as (
    select * from legacy where name_key <> ''
  ),
  by_name_ranked as (
    select l.id as session_id,
           t.id as track_id,
           case when t.is_seeded then 1 else 0 end as precedence
      from named l
      join public.tracks t
        on (t.is_seeded or t.created_by = l.user_id)
       and lower(btrim(regexp_replace(normalize(t.name, NFC),
             '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'))) = l.name_key
  ),
  by_name as (
    select r.session_id, array_agg(r.track_id order by r.track_id) as track_ids
      from by_name_ranked r
     where r.precedence = (select min(o.precedence) from by_name_ranked o where o.session_id = r.session_id)
     group by r.session_id
  ),
  by_alias as (
    select l.id as session_id, array_agg(distinct t.id order by t.id) as track_ids
      from named l
      join public.track_aliases a
        on lower(btrim(regexp_replace(normalize(a.alias, NFC),
             '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'))) = l.name_key
      join public.tracks t
        on t.id = a.track_id
       and (t.is_seeded or t.created_by = l.user_id)
     where not exists (select 1 from by_name n where n.session_id = l.id)
     group by l.id
  ),
  resolved as (
    select l.id, l.user_id, l.track_name,
           coalesce(n.track_ids, a.track_ids, '{}'::uuid[]) as track_ids
      from named l
      left join by_name n on n.session_id = l.id
      left join by_alias a on a.session_id = l.id
  ),
  relinked as (
    update public.sessions s
       set track_id = r.track_ids[1]
      from resolved r
     where s.id = r.id
       and cardinality(r.track_ids) = 1
       and s.track_id is null
    returning s.id
  )
  select r.id,
         r.user_id,
         r.track_name,
         case
           when u.id is not null then 'relinked'
           when cardinality(r.track_ids) > 1 then 'ambiguous'
           else 'unmatched'
         end,
         case when u.id is not null then r.track_ids[1] end,
         r.track_ids
    from resolved r
    left join relinked u on u.id = r.id
   -- A single match that was not written was linked by someone else between
   -- the read and the write; it is no longer a legacy row, so it is not reported.
   where u.id is not null or cardinality(r.track_ids) <> 1
   order by 4, r.user_id, r.track_name, r.id;
$$;

revoke all on function public.relink_legacy_session_tracks(uuid) from public, anon, authenticated;
grant execute on function public.relink_legacy_session_tracks(uuid) to service_role;

select * from public.relink_legacy_session_tracks();
