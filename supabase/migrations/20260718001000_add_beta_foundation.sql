alter table public.profiles
  add column if not exists beta_cohort text,
  add column if not exists beta_access_started_at timestamptz,
  add column if not exists beta_access_expires_at timestamptz;

create table if not exists public.beta_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text not null unique,
  vehicle_interest text not null,
  activity_type text not null,
  experience_level text not null,
  current_tracking_method text not null,
  upcoming_track_days text not null,
  optional_context text,
  consent_at timestamptz not null,
  status text not null default 'waitlisted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_waitlist_vehicle_check check (vehicle_interest in ('motorcycle', 'car', 'both')),
  constraint beta_waitlist_activity_check check (activity_type in ('track_day', 'hpde', 'club_racing')),
  constraint beta_waitlist_experience_check check (experience_level in ('beginner', 'intermediate', 'advanced')),
  constraint beta_waitlist_method_check check (current_tracking_method in ('paper', 'phone_notes', 'spreadsheet', 'other_app', 'none')),
  constraint beta_waitlist_days_check check (upcoming_track_days in ('zero', 'one', 'two_or_more')),
  constraint beta_waitlist_status_check check (status in ('waitlisted', 'invited', 'accepted', 'declined')),
  constraint beta_waitlist_context_check check (optional_context is null or char_length(optional_context) <= 500)
);

create table if not exists public.beta_invites (
  id uuid primary key default gen_random_uuid(),
  waitlist_id uuid references public.beta_waitlist(id) on delete set null,
  email_normalized text not null,
  code_hash text not null unique,
  cohort text not null default 'motorcycle-founding',
  status text not null default 'active',
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_invites_status_check check (status in ('active', 'redeemed', 'revoked', 'expired'))
);

create index if not exists beta_invites_email_idx on public.beta_invites(email_normalized);

create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null,
  session_id uuid references public.sessions(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint product_events_name_check check (event_name in (
    'beta_signup_completed', 'vehicle_created', 'session_created',
    'lap_data_saved', 'comparison_viewed', 'session_outcome_prompt_viewed',
    'session_outcome_saved', 'recommendation_linked_to_outcome',
    'beta_survey_submitted'
  ))
);

create index if not exists product_events_user_created_idx
  on public.product_events(user_id, created_at desc);

create table if not exists public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  comparison_usefulness smallint not null,
  ai_guidance_usefulness smallint not null,
  disappointment text not null,
  biggest_problem text,
  interview_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_feedback_comparison_check check (comparison_usefulness between 1 and 5),
  constraint beta_feedback_ai_check check (ai_guidance_usefulness between 1 and 5),
  constraint beta_feedback_disappointment_check check (disappointment in ('very', 'somewhat', 'not')),
  constraint beta_feedback_problem_check check (biggest_problem is null or char_length(biggest_problem) <= 1000)
);

create table if not exists public.beta_rate_limits (
  key_hash text primary key,
  request_count integer not null,
  window_expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint beta_rate_limits_count_check check (request_count > 0)
);

create index if not exists beta_rate_limits_expiry_idx
  on public.beta_rate_limits(window_expires_at);

create or replace function public.create_beta_invite(
  p_waitlist_id uuid,
  p_email_normalized text,
  p_code_hash text,
  p_cohort text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_id uuid;
  updated_waitlist_count integer;
begin
  insert into public.beta_invites (
    waitlist_id, email_normalized, code_hash, cohort, expires_at
  ) values (
    p_waitlist_id, p_email_normalized, p_code_hash, p_cohort, p_expires_at
  )
  returning id into invite_id;

  if p_waitlist_id is not null then
    update public.beta_waitlist
    set status = 'invited'
    where id = p_waitlist_id and email_normalized = p_email_normalized;

    get diagnostics updated_waitlist_count = row_count;
    if updated_waitlist_count <> 1 then
      raise exception 'matching waitlist entry not found';
    end if;
  end if;

  return invite_id;
end;
$$;

revoke all on function public.create_beta_invite(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_beta_invite(uuid, text, text, text, timestamptz)
  to service_role;

create or replace function public.consume_beta_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  limited boolean;
begin
  if p_key_hash is null or p_key_hash = '' or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate-limit arguments';
  end if;

  insert into public.beta_rate_limits (
    key_hash, request_count, window_expires_at, updated_at
  ) values (
    p_key_hash, 1, now() + make_interval(secs => p_window_seconds), now()
  )
  on conflict (key_hash) do update set
    request_count = case
      when beta_rate_limits.window_expires_at <= now() then 1
      else beta_rate_limits.request_count + 1
    end,
    window_expires_at = case
      when beta_rate_limits.window_expires_at <= now()
        then now() + make_interval(secs => p_window_seconds)
      else beta_rate_limits.window_expires_at
    end,
    updated_at = now()
  returning request_count > p_limit into limited;

  return limited;
end;
$$;

revoke all on function public.consume_beta_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_beta_rate_limit(text, integer, integer)
  to service_role;

drop trigger if exists beta_waitlist_set_updated_at on public.beta_waitlist;
create trigger beta_waitlist_set_updated_at before update on public.beta_waitlist
  for each row execute function public.set_updated_at();
drop trigger if exists beta_invites_set_updated_at on public.beta_invites;
create trigger beta_invites_set_updated_at before update on public.beta_invites
  for each row execute function public.set_updated_at();
drop trigger if exists beta_feedback_set_updated_at on public.beta_feedback;
create trigger beta_feedback_set_updated_at before update on public.beta_feedback
  for each row execute function public.set_updated_at();

alter table public.beta_waitlist enable row level security;
alter table public.beta_invites enable row level security;
alter table public.product_events enable row level security;
alter table public.beta_feedback enable row level security;
alter table public.beta_rate_limits enable row level security;

-- Waitlist and invite operations use the server-only service-role client.
create policy "product_events: select own" on public.product_events for select
  using (auth.uid() = user_id);
create policy "product_events: insert own" on public.product_events for insert
  with check (
    auth.uid() = user_id
    and (session_id is null or exists (
      select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()
    ))
    and (vehicle_id is null or exists (
      select 1 from public.vehicles v where v.id = vehicle_id and v.user_id = auth.uid()
    ))
  );
create policy "beta_feedback: select own" on public.beta_feedback for select
  using (auth.uid() = user_id);
create policy "beta_feedback: insert own" on public.beta_feedback for insert
  with check (auth.uid() = user_id);
create policy "beta_feedback: update own" on public.beta_feedback for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
