-- Somewhere to keep the text of a rider's AI request for 90 days, and the
-- machinery that deletes it on time. NOTHING WRITES THIS TABLE YET.
--
-- Race Engineer questions (and the Morning Plan's track name and conditions)
-- are to be kept so they can be replayed through a new version of the guards in
-- Redline, the owner's AI-safety lab. This migration is the first of four steps
-- and deliberately stores nothing: the notice and the rider's controls ship
-- before the first byte of text is captured, so this file only has to make the
-- 90-day promise enforceable before anything relies on it.
--
-- WHY A TABLE OF ITS OWN RATHER THAN COLUMNS ON ai_requests
--
-- ai_requests is the rate limit, the refusal throttle, the dedupe window and the
-- health monitor. A rider must be able to delete their question text and must
-- never be able to delete those rows, or deleting their history would reset
-- their own rate limit. So the text lives here, with its own grants and its own
-- lifetime, and cascades from both ai_requests (a released reservation takes its
-- text with it) and auth.users (deleting an account deletes the text at once).
--
-- `submitted` holds the rider-authored fields exactly as the route validated
-- them, after redaction:
--   tuning_advice: {question, symptoms, change_intent}
--   day_plan:      {track_name, weather_condition, surface_condition, target_date}
-- `redaction_version` says which redaction rules produced it, so a replay can
-- tell rows masked under different rules apart.

create table if not exists public.ai_request_text (
  request_id text primary key
    references public.ai_requests(request_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  route text not null check (route in ('tuning_advice', 'day_plan')),
  submitted jsonb not null check (jsonb_typeof(submitted) = 'object'),
  redaction_version smallint not null,
  created_at timestamptz not null default now(),
  retain_until timestamptz not null default now() + interval '90 days'
);

create index if not exists ai_request_text_user_created_idx
  on public.ai_request_text(user_id, created_at desc);

create index if not exists ai_request_text_retain_until_idx
  on public.ai_request_text(retain_until);

alter table public.ai_request_text enable row level security;

create policy "ai_request_text: select own"
  on public.ai_request_text for select
  using (auth.uid() = user_id);

create policy "ai_request_text: delete own"
  on public.ai_request_text for delete
  using (auth.uid() = user_id);

-- A rider may see and delete their own rows, and nothing else. INSERT and UPDATE
-- are withheld on purpose and no policy could give them back safely: RLS picks
-- the row, not the column, so an update grant would let a rider push their own
-- `retain_until` past 90 days, or rewrite `submitted` so the verdict recorded
-- against a request describes a question that was never asked. Rows are
-- written by the routes through the service client, the way ai_requests is.
-- service_role reaches this table through the default privileges
-- 20260719001100 set; anon gets nothing, as everywhere else.
--
-- The revoke comes first because the hosted project may never have had
-- 20260719001100 applied (CLAUDE.md, "A migration in this repository is not
-- evidence the hosted project has it"). There, Supabase's legacy default
-- privileges hand every new table to anon and authenticated with `grant all`,
-- so without this line the grant below would be a no-op beside an UPDATE the
-- rider already holds. On a database built from these migrations it revokes
-- nothing.
revoke all on public.ai_request_text from public, anon, authenticated;
grant select, delete on public.ai_request_text to authenticated;

-- Which commit's guards produced a verdict, from VERCEL_GIT_COMMIT_SHA (null
-- locally). It describes the verdict rather than the text, so it lives on
-- ai_requests and survives the purge.
alter table public.ai_requests
  add column if not exists app_commit text;

-- WHETHER A RIDER'S TEXT MAY BE KEPT
--
-- Four columns, each recording one fact with the time it became true, because a
-- consent record is worth what its provenance is worth:
--
--   ai_question_retention_notice_seen_at  when the rider was shown the notice.
--     Null for every rider who exists when this runs, and nothing of theirs is
--     kept until it is set. New riders are shown it up front at signup.
--   ai_question_retention_opted_out_at    when the rider turned keeping off.
--   ai_question_retention_opted_in_at     when the rider turned keeping on.
--     Only needed where keeping starts off; see the next column.
--   ai_question_retention_requires_opt_in whether this rider starts with the
--     switch off. True for EU and UK signups.
--
-- The rule the capture step will apply, written here so it has one statement:
-- text is kept only when notice_seen_at is set, opted_out_at is null, and
-- either requires_opt_in is false or opted_in_at is set. Turning the switch
-- on sets opted_in_at and clears opted_out_at; turning it off does the reverse
-- and deletes what is held.
--
-- Every column is written by a server action through the service client.
-- authenticated keeps SELECT only on profiles (20260719001100), and these are
-- no exception: a rider who could write them could backdate a consent.
alter table public.profiles
  add column if not exists ai_question_retention_notice_seen_at timestamptz,
  add column if not exists ai_question_retention_opted_out_at timestamptz,
  add column if not exists ai_question_retention_opted_in_at timestamptz,
  add column if not exists ai_question_retention_requires_opt_in boolean not null default false;

-- THE 90-DAY PURGE
--
-- Deletes every text row past its retain_until, and nulls the 140-character
-- redacted preview on ai_requests rows older than 90 days, because that preview
-- is question text too and the notice promises 90 days for every copy. The
-- ai_requests rows themselves, their fingerprint and their verdict are kept.
--
-- security definer so the cron job needs no grant on either table; search_path
-- pinned empty and every name qualified, as security definer requires. Returns
-- how many text rows it removed.
create or replace function public.purge_expired_ai_request_text()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.ai_request_text where retain_until < now();
  get diagnostics removed = row_count;

  update public.ai_requests
     set prompt_redacted_preview = null
   where prompt_redacted_preview is not null
     and created_at < now() - interval '90 days';

  return removed;
end;
$$;

revoke all on function public.purge_expired_ai_request_text() from public, anon, authenticated;
grant execute on function public.purge_expired_ai_request_text() to service_role;

-- The trigger lives in the database with the data, so the promise does not
-- depend on a GitHub schedule that goes quiet after 60 days without a commit,
-- a Vercel plan, or a route being reachable. Whether it actually runs is not
-- taken on trust: /api/health's ai_text_retention check fails when any row is
-- more than 36 hours past its retain_until. A row already waits up to 24 hours
-- for the next daily run, so a single missed run can trip it.
--
-- cron.schedule with a job name replaces a job of that name, so re-running this
-- file leaves one job rather than two.
create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;

select cron.schedule(
  'purge-expired-ai-request-text',
  '17 4 * * *',
  $$select public.purge_expired_ai_request_text()$$
);
