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
-- THE RULES ARE lib/track-lookup.ts's, WRITTEN IN SQL, WHERE THEY ARE NOT IN DOUBT
--
-- `findVisibleTrackByName`, then `findVisibleTrackByAlias`, in the scope the
-- session's own rider sees (`visibleTracksFilter`: seeded, or created by them):
--
--   - names are equal when `trackNameKey` folds them equal - NFC, runs of
--     whitespace collapsed, trimmed, lowercased. The whitespace class is
--     JavaScript's `\s` spelled out, because Postgres's `\s` leaves U+FEFF out;
--   - an alias is consulted only when no name matched.
--
-- Two deliberate differences, both cases where a save picks for the rider in
-- front of the form and a backfill picking for a rider who is not there would
-- be a guess, so the row is left alone and reported with its candidates:
--
--   - a name matching both a track of the rider's own and a seeded circuit, by
--     name or by alias, is `own_and_seeded`. A save today takes the rider's own
--     track; ADR 0001 decision 8 sends that name to the seeded circuit instead,
--     and decision 9 moves a rider's sessions off their own duplicate only with
--     their yes. Linking either way here would write one of those two rules
--     into every rider's history without asking, so neither is written;
--   - two tracks of one kind that fold to one name - almost always two custom
--     tracks of the rider's own - are `ambiguous`, where the resolver takes the
--     first.
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
  matches as (
    select l.id as session_id, t.id as track_id, t.is_seeded, true as by_name
      from named l
      join public.tracks t
        on (t.is_seeded or t.created_by = l.user_id)
       and lower(btrim(regexp_replace(normalize(t.name, NFC),
             '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'))) = l.name_key
    union
    select l.id, t.id, t.is_seeded, false
      from named l
      join public.track_aliases a
        on lower(btrim(regexp_replace(normalize(a.alias, NFC),
             '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'))) = l.name_key
      join public.tracks t
        on t.id = a.track_id
       and (t.is_seeded or t.created_by = l.user_id)
  ),
  grouped as (
    select m.session_id,
           bool_or(m.is_seeded) and bool_or(not m.is_seeded) as own_and_seeded,
           array_agg(distinct m.track_id order by m.track_id) as all_ids,
           array_agg(distinct m.track_id order by m.track_id) filter (where m.by_name) as name_ids,
           array_agg(distinct m.track_id order by m.track_id) filter (where not m.by_name) as alias_ids
      from matches m
     group by m.session_id
  ),
  resolved as (
    select l.id, l.user_id, l.track_name,
           coalesce(g.own_and_seeded, false) as own_and_seeded,
           case when g.own_and_seeded then g.all_ids
                else coalesce(g.name_ids, g.alias_ids, '{}'::uuid[]) end as track_ids
      from named l
      left join grouped g on g.session_id = l.id
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
           when r.own_and_seeded then 'own_and_seeded'
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
