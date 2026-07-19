alter table public.profiles
  add column if not exists beta_cohort text,
  add column if not exists beta_access_started_at timestamptz,
  add column if not exists beta_access_expires_at timestamptz;

alter table public.session_feedback
  add column if not exists reference_session_id uuid references public.sessions(id) on delete set null,
  add column if not exists recommendation_helpfulness smallint;

alter table public.session_feedback
  drop constraint if exists session_feedback_recommendation_helpfulness_check;

alter table public.session_feedback
  add constraint session_feedback_recommendation_helpfulness_check
    check (
      recommendation_helpfulness is null
      or (recommendation_helpfulness >= 1 and recommendation_helpfulness <= 5)
    );

-- Keep the newest row before enforcing one editable outcome per session and one
-- outcome per recommendation. The app had no public users when this migration was
-- introduced, but the cleanup keeps local and preview databases safe to migrate.
delete from public.session_feedback older
using public.session_feedback newer
where older.session_id = newer.session_id
  and (older.updated_at, older.id) < (newer.updated_at, newer.id);

delete from public.session_feedback older
using public.session_feedback newer
where older.recommendation_id is not null
  and older.recommendation_id = newer.recommendation_id
  and (older.updated_at, older.id) < (newer.updated_at, newer.id);

create unique index if not exists session_feedback_session_id_key
  on public.session_feedback(session_id);

create unique index if not exists session_feedback_recommendation_id_key
  on public.session_feedback(recommendation_id)
  where recommendation_id is not null;

create index if not exists session_feedback_reference_session_idx
  on public.session_feedback(reference_session_id);

create or replace function public.save_session_outcome(
  p_user_id uuid,
  p_session_id uuid,
  p_reference_session_id uuid,
  p_recommendation_id uuid,
  p_outcome text,
  p_rider_confidence smallint,
  p_symptoms text[],
  p_notes text,
  p_recommendation_helpfulness smallint
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  outcome_session public.sessions%rowtype;
  reference_session public.sessions%rowtype;
  recommendation_row public.ai_recommendations%rowtype;
  previous_recommendation_id uuid;
  saved_feedback public.session_feedback%rowtype;
  outcome_best integer;
  reference_best integer;
  tracks_match boolean;
  latest_summary text;
  feedback_count integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'save_session_outcome caller mismatch';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and (
        p.tier = 'pro'
        or (
          p.beta_access_expires_at > now()
          and (p.beta_access_started_at is null or p.beta_access_started_at <= now())
        )
      )
  ) then
    raise exception 'save_session_outcome requires pro access';
  end if;

  if p_outcome not in ('better', 'same', 'worse', 'unknown') then
    raise exception 'invalid session outcome';
  end if;

  select * into outcome_session
  from public.sessions
  where id = p_session_id and user_id = p_user_id;

  select * into reference_session
  from public.sessions
  where id = p_reference_session_id and user_id = p_user_id;

  if outcome_session.id is null or reference_session.id is null then
    raise exception 'session not found';
  end if;

  if outcome_session.vehicle_id <> reference_session.vehicle_id then
    raise exception 'session vehicle mismatch';
  end if;

  tracks_match := (
    outcome_session.track_id is not null
    and reference_session.track_id is not null
    and outcome_session.track_id = reference_session.track_id
  ) or (
    (outcome_session.track_id is null or reference_session.track_id is null)
    and nullif(lower(btrim(coalesce(outcome_session.track_name, ''))), '') is not null
    and lower(btrim(outcome_session.track_name)) = lower(btrim(reference_session.track_name))
  );

  if (reference_session.date, coalesce(reference_session.start_time, '00:00'::time), reference_session.created_at)
     >= (outcome_session.date, coalesce(outcome_session.start_time, '00:00'::time), outcome_session.created_at) then
    raise exception 'reference session must be earlier';
  end if;

  if p_rider_confidence is not null and (p_rider_confidence < 1 or p_rider_confidence > 5) then
    raise exception 'invalid rider confidence';
  end if;

  if p_recommendation_helpfulness is not null
     and (p_recommendation_helpfulness < 1 or p_recommendation_helpfulness > 5) then
    raise exception 'invalid recommendation helpfulness';
  end if;

  if p_recommendation_id is null and p_recommendation_helpfulness is not null then
    raise exception 'helpfulness requires a recommendation';
  end if;

  if p_recommendation_id is not null then
    select * into recommendation_row
    from public.ai_recommendations
    where id = p_recommendation_id
      and user_id = p_user_id
      and vehicle_id = outcome_session.vehicle_id
      and (session_id is null or session_id <> outcome_session.id);

    if recommendation_row.id is null then
      raise exception 'recommendation not found';
    end if;
  end if;

  select recommendation_id into previous_recommendation_id
  from public.session_feedback
  where session_id = p_session_id and user_id = p_user_id;

  select nullif(metrics->>'best_lap_ms', '')::integer into outcome_best
  from public.telemetry_summaries
  where session_id = p_session_id and user_id = p_user_id;

  select nullif(metrics->>'best_lap_ms', '')::integer into reference_best
  from public.telemetry_summaries
  where session_id = p_reference_session_id and user_id = p_user_id;

  insert into public.session_feedback (
    user_id,
    session_id,
    reference_session_id,
    vehicle_id,
    track_id,
    recommendation_id,
    outcome,
    rider_confidence,
    symptoms,
    notes,
    lap_time_delta_ms,
    recommendation_helpfulness,
    updated_at
  ) values (
    p_user_id,
    p_session_id,
    p_reference_session_id,
    outcome_session.vehicle_id,
    outcome_session.track_id,
    p_recommendation_id,
    p_outcome,
    p_rider_confidence,
    coalesce(p_symptoms, '{}'::text[]),
    nullif(btrim(coalesce(p_notes, '')), ''),
    case when tracks_match and outcome_best is not null and reference_best is not null
      then outcome_best - reference_best else null end,
    p_recommendation_helpfulness,
    now()
  )
  on conflict (session_id) do update set
    reference_session_id = excluded.reference_session_id,
    track_id = excluded.track_id,
    recommendation_id = excluded.recommendation_id,
    outcome = excluded.outcome,
    rider_confidence = excluded.rider_confidence,
    symptoms = excluded.symptoms,
    notes = excluded.notes,
    lap_time_delta_ms = excluded.lap_time_delta_ms,
    recommendation_helpfulness = excluded.recommendation_helpfulness,
    updated_at = now()
  returning * into saved_feedback;

  if previous_recommendation_id is not null
     and previous_recommendation_id is distinct from p_recommendation_id then
    update public.ai_recommendations
    set status = 'proposed', outcome_session_id = null, updated_at = now()
    where id = previous_recommendation_id and user_id = p_user_id;
  end if;

  if p_recommendation_id is not null then
    update public.ai_recommendations
    set status = 'applied', outcome_session_id = p_session_id, updated_at = now()
    where id = p_recommendation_id and user_id = p_user_id;
  end if;

  select count(*)::integer into feedback_count
  from public.session_feedback
  where user_id = p_user_id and vehicle_id = outcome_session.vehicle_id;

  latest_summary := format(
    'Latest outcome at %s: %s with %s.%s',
    coalesce(outcome_session.track_name, 'unknown track'),
    p_outcome,
    case when coalesce(array_length(p_symptoms, 1), 0) > 0
      then array_to_string(p_symptoms, ', ')
      else 'no structured symptoms' end,
    case when p_notes is not null and btrim(p_notes) <> ''
      then ' Notes: ' || p_notes else '' end
  );

  insert into public.race_engineer_memory (
    user_id, vehicle_id, track_id, summary, patterns, evidence_count, updated_at
  ) values (
    p_user_id,
    outcome_session.vehicle_id,
    outcome_session.track_id,
    latest_summary,
    jsonb_build_object('last_feedback', to_jsonb(saved_feedback)),
    feedback_count,
    now()
  )
  on conflict (user_id, vehicle_id, track_id) do update set
    summary = excluded.summary,
    patterns = excluded.patterns,
    evidence_count = excluded.evidence_count,
    updated_at = now();

  return to_jsonb(saved_feedback);
end;
$$;
