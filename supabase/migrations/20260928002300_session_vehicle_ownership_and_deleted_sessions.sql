-- Three fixes to how a session is written, applied together so the hosted
-- project takes them in one paste ("Close session ownership, deleted-session
-- replays and the free-plan race by hand" in docs/beta-runbook.md).
--
-- 1. A SESSION'S VEHICLE IS THE RIDER'S, ON EVERY PATH. `sessions: insert own`
--    and `sessions: update own` checked only `user_id`, so a crafted request -
--    or an outbox synced under a different account - could store a session on
--    another rider's vehicle, and that rider deleting the vehicle would cascade
--    the session away. `create_session_with_laps` has refused one since
--    20260927002200 (`TT404`); the website form writes the row directly and did
--    not. The policies now require the vehicle to be one the rider owns, so no
--    path can store or move a session onto someone else's (owner, 2026-09-27:
--    "yes go with both"). The function keeps its own check: it names the
--    refusal with a code the phone parks, where the policy's `42501` reads as a
--    fault it would retry.
--
-- 2. A DELETED SESSION STAYS DELETED. The phone's create is idempotent on the
--    id it minted, and "already handled" meant "a row with this id exists". If
--    the save committed but its answer was lost, and the rider then deleted the
--    session on the website, the phone's retry found no row and created it
--    again. `deleted_sessions` records the id of every session deleted - by the
--    rider, with its vehicle, or by the website rolling back a failed save - and
--    the function answers a create on a recorded id as a replay that wrote
--    nothing, `{ "replayed": true, "deleted": true, "session": null }`, so the
--    phone clears its outbox entry (owner: "B", deferred here from PR 91).
--
--    It is written by a trigger rather than by the delete action, because a
--    session also goes when its vehicle is deleted, and that cascade reaches no
--    application code. The trigger skips a session whose rider is being deleted:
--    the tombstone would reference an account the same statement removes, and
--    its foreign key would fail the account delete.
--
--    Kept for as long as the account. A row is two ids and a timestamp, one per
--    session a rider ever deleted, and any expiry reopens the defect for a phone
--    that has been offline longer than it - a phone in a drawer since the last
--    track day is exactly that. The account's own delete takes them all.
--
-- 3. THE FREE-PLAN CAP HOLDS UNDER CONCURRENCY. The route counted the rider's
--    sessions and then called this function, so two different phone saves at a
--    count of nine both passed the count and both committed (found by the Codex
--    review of PR 91; owner: "A"). The count now runs inside the function under
--    a per-rider transaction advisory lock, so two creates for one rider
--    serialize and the second counts the first. The entitlement is read here
--    too, under the same lock, and mirrors `resolveUserAccess` (lib/access.ts):
--    Pro, or a beta window that has started and not expired, is unlimited;
--    anything else - including no profile row - holds `getFreePlanLimit('sessions')`,
--    which is 10 (lib/plans.ts). `tests/unit/session-create-plan-cap.test.ts`
--    fails when either side moves without the other. Over the cap is `TT402`,
--    which the route answers 402 and the phone parks.
--
--    What the lock covers is this function. The website form still counts in
--    the application and inserts directly, so a form save racing a phone save at
--    nine can still reach eleven; that path has no transaction to hold a lock in.
--
-- THE HOSTED PROJECT NAMES ITS SESSION POLICIES DIFFERENTLY. The baseline
-- (20260223000000) calls them "sessions: select own" and so on, reconstructed
-- rather than read off the hosted project, which has the same four policies as
-- "Users can select own sessions", "Users can insert own sessions", "Users can
-- update own sessions" and "Users can delete own sessions" (owner's precheck,
-- 2026-09-29). `alter policy` finds a policy by name, so the block below renames
-- any of those it finds to the baseline's name first, in the same transaction.
-- A database built from these migrations has none of them and renames nothing;
-- the hosted one comes out with the names every migration and check here uses.
-- If both names of one policy exist, the rename fails and nothing is applied:
-- that is two policies where one belongs, and a finding to decide first.
--
-- The lock is taken before the replay lookup, so a second call on the same id
-- waits for the first and then finds its row, as it did on the primary key
-- before. `create_session_with_laps` keeps its signature, so the release before
-- this one calls it unchanged.

create table if not exists public.deleted_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  deleted_at timestamptz not null default now(),
  primary key (user_id, session_id)
);

alter table public.deleted_sessions enable row level security;

create policy "deleted_sessions: select own"
  on public.deleted_sessions for select
  using (auth.uid() = user_id);

-- A rider reads their own - `create_session_with_laps` is security invoker - and
-- writes none: only the trigger does. The revoke comes first because the hosted
-- project's legacy default privileges hand every new table to anon and
-- authenticated with `grant all`.
revoke all on public.deleted_sessions from public, anon, authenticated;
grant select on public.deleted_sessions to authenticated;

-- security definer because it writes a table no rider may insert into, and
-- because an account delete runs as the auth service, which holds no grant on
-- it. It cannot be called directly - it returns `trigger` - but the execute
-- decision is written down here as for every security definer function.
create or replace function public.record_deleted_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from auth.users u where u.id = old.user_id) then
    insert into public.deleted_sessions (user_id, session_id)
    values (old.user_id, old.id)
    on conflict do nothing;
  end if;
  return old;
end;
$$;

revoke all on function public.record_deleted_session() from public, anon, authenticated;

drop trigger if exists sessions_record_deleted on public.sessions;
create trigger sessions_record_deleted
  after delete on public.sessions
  for each row execute function public.record_deleted_session();

do $$
declare
  v_policy record;
begin
  for v_policy in
    select r.hosted_name, r.repo_name
      from (values
        ('Users can select own sessions', 'sessions: select own'),
        ('Users can insert own sessions', 'sessions: insert own'),
        ('Users can update own sessions', 'sessions: update own'),
        ('Users can delete own sessions', 'sessions: delete own')
      ) as r(hosted_name, repo_name)
     where exists (
       select 1
         from pg_catalog.pg_policies p
        where p.schemaname = 'public'
          and p.tablename = 'sessions'
          and p.policyname = r.hosted_name
     )
  loop
    execute pg_catalog.format('alter policy %I on public.sessions rename to %I', v_policy.hosted_name, v_policy.repo_name);
  end loop;
end;
$$;

alter policy "sessions: insert own"
  on public.sessions
  with check (
    auth.uid() = user_id
    and exists (
      select 1
        from public.vehicles v
       where v.id = sessions.vehicle_id
         and v.user_id = auth.uid()
    )
  );

alter policy "sessions: update own"
  on public.sessions
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1
        from public.vehicles v
       where v.id = sessions.vehicle_id
         and v.user_id = auth.uid()
    )
  );

create or replace function public.create_session_with_laps(
  p_session_id uuid,
  p_session jsonb,
  p_laps jsonb,
  p_environment jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_unlimited boolean;
begin
  if auth.uid() is null then
    raise exception 'create_session_with_laps needs a signed-in rider' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('create_session_with_laps:' || auth.uid()::text, 0));

  select s.* into v_session
    from public.sessions s
   where s.id = p_session_id
     and s.user_id = auth.uid();

  if found then
    return jsonb_build_object('replayed', true, 'session', to_jsonb(v_session));
  end if;

  if exists (
    select 1
      from public.deleted_sessions d
     where d.user_id = auth.uid()
       and d.session_id = p_session_id
  ) then
    return jsonb_build_object('replayed', true, 'deleted', true, 'session', null);
  end if;

  select p.tier = 'pro'
         or (p.beta_access_expires_at > now()
             and (p.beta_access_started_at is null or p.beta_access_started_at <= now()))
    into v_unlimited
    from public.profiles p
   where p.id = auth.uid();

  if not coalesce(v_unlimited, false)
     and (select count(*) from public.sessions s where s.user_id = auth.uid()) >= 10 then
    raise exception 'the free plan holds 10 sessions' using errcode = 'TT402';
  end if;

  if not exists (
    select 1
      from public.vehicles v
     where v.id = (p_session ->> 'vehicle_id')::uuid
       and v.user_id = auth.uid()
  ) then
    raise exception 'the vehicle this session names is not one of this rider''s'
      using errcode = 'TT404';
  end if;

  begin
    insert into public.sessions (
      id, user_id, vehicle_id, track_id, track_name, layout_id, layout_name,
      date, start_time, session_number, conditions, tires, suspension,
      alignment, enabled_modules, extra_modules, notes
    )
    select
      p_session_id, auth.uid(), r.vehicle_id, r.track_id, r.track_name, r.layout_id, r.layout_name,
      r.date, r.start_time, r.session_number, r.conditions, r.tires, r.suspension,
      r.alignment, coalesce(r.enabled_modules, '{}'::jsonb), r.extra_modules, r.notes
    from jsonb_populate_record(null::public.sessions, p_session) r
    returning * into v_session;
  exception when unique_violation then
    select s.* into v_session
      from public.sessions s
     where s.id = p_session_id
       and s.user_id = auth.uid();

    if found then
      return jsonb_build_object('replayed', true, 'session', to_jsonb(v_session));
    end if;

    raise;
  end;

  perform public.replace_session_laps(auth.uid(), p_session_id, p_laps, '[]'::jsonb);

  if p_environment is not null then
    insert into public.session_environment (
      user_id, session_id, ambient_temperature_c, track_temperature_c,
      humidity_percent, weather_condition, surface_condition, source
    )
    select
      auth.uid(), p_session_id, r.ambient_temperature_c, r.track_temperature_c,
      r.humidity_percent, r.weather_condition, r.surface_condition, coalesce(r.source, 'manual')
    from jsonb_populate_record(null::public.session_environment, p_environment) r;
  end if;

  return jsonb_build_object('replayed', false, 'session', to_jsonb(v_session));
end;
$$;

revoke all on function public.create_session_with_laps(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_session_with_laps(uuid, jsonb, jsonb, jsonb) to authenticated;
