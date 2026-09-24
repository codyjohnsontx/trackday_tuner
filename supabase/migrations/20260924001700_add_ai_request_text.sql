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

--
-- OWNERSHIP IS THE PARENT'S, NOT THE WRITER'S. RLS below trusts `user_id` on
-- this row, so a text row naming rider B under rider A's request would show A's
-- question to B and hide it from A. The foreign key is therefore on
-- (request_id, user_id) together, against a unique key on ai_requests over the
-- same pair, and the database refuses a mismatch whatever the service writer
-- passes.
--
-- THE 90 DAYS ARE A CONSTRAINT, NOT A DEFAULT. The purge and the health check
-- both read `retain_until`, so a writer passing a later value would keep text
-- past the notice and be reported healthy. The check caps it at created_at plus
-- 90 days; an earlier deadline is allowed, since deleting sooner breaks no
-- promise. The check alone trusts created_at, which the writer could also pass,
-- so a trigger below pins created_at to the insert time and clamps retain_until
-- to 90 days after it.
create unique index if not exists ai_requests_request_id_user_id_key
  on public.ai_requests(request_id, user_id);

create table if not exists public.ai_request_text (
  request_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  route text not null check (route in ('tuning_advice', 'day_plan')),
  submitted jsonb not null check (jsonb_typeof(submitted) = 'object'),
  redaction_version smallint not null,
  created_at timestamptz not null default now(),
  retain_until timestamptz not null default now() + interval '90 days',
  constraint ai_request_text_request_owner_fkey
    foreign key (request_id, user_id)
    references public.ai_requests(request_id, user_id) on delete cascade,
  constraint ai_request_text_retain_until_within_90_days
    check (retain_until <= created_at + interval '90 days')
);

-- Whatever a writer passes, a row starts now and ends within 90 days of now. An
-- earlier retain_until the writer supplies is kept. Insert only: the rider
-- holds no UPDATE, and the check above still bounds one by the service role.
create or replace function public.ai_request_text_pin_retention()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  new.retain_until := least(new.retain_until, new.created_at + interval '90 days');
  return new;
end;
$$;

create or replace trigger ai_request_text_pin_retention
  before insert on public.ai_request_text
  for each row execute function public.ai_request_text_pin_retention();

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
-- The rule, which the view below states once in SQL: a rider's text is kept
-- only when notice_seen_at is set, opted_out_at is null, and either
-- requires_opt_in is false or opted_in_at is set. Consent is judged as of when
-- the text was written, not when it is checked: text written before the notice
-- was seen, or before the latest opt-in, is never kept, even once the rider has
-- since agreed. A rider with no profiles row meets none of it, so nothing of
-- theirs is kept. Turning the switch on sets opted_in_at and clears
-- opted_out_at; turning it off does the reverse and deletes what is held.
--
-- Every column is written by a server action through the service client.
-- authenticated keeps SELECT only on profiles (20260719001100), and these are
-- no exception: a rider who could write them could backdate a consent.
alter table public.profiles
  add column if not exists ai_question_retention_notice_seen_at timestamptz,
  add column if not exists ai_question_retention_opted_out_at timestamptz,
  add column if not exists ai_question_retention_opted_in_at timestamptz,
  add column if not exists ai_question_retention_requires_opt_in boolean not null default false;

-- Every ai_requests row still carrying a preview whose rider's text may not be
-- kept. It is the one place the rule above is written in SQL: the clear below,
-- the purge and /api/health all read it, so none of them can apply a narrower
-- rule than the others. PostgREST cannot join ai_requests to profiles (neither
-- references the other), which is why it is a view rather than a filter.
-- security_invoker so it runs with the caller's privileges and RLS rather than
-- its owner's; it is for the service role alone, and the revoke is explicit
-- because hosted's legacy defaults would otherwise hand it to anon and
-- authenticated. It exposes ids and times, never the preview text.
create or replace view public.ai_requests_unretainable_previews
  with (security_invoker = true)
as
select r.request_id, r.created_at
  from public.ai_requests r
 where r.prompt_redacted_preview is not null
   and not exists (
     select 1 from public.profiles p
      where p.id = r.user_id
        and p.ai_question_retention_notice_seen_at is not null
        and p.ai_question_retention_opted_out_at is null
        and (not p.ai_question_retention_requires_opt_in
             or p.ai_question_retention_opted_in_at is not null)
        and r.created_at >= greatest(p.ai_question_retention_notice_seen_at,
                                     p.ai_question_retention_opted_in_at)
   );

revoke all on public.ai_requests_unretainable_previews from public, anon, authenticated;
grant select on public.ai_requests_unretainable_previews to service_role;

-- NOTHING OF A RIDER'S IS KEPT UNTIL THEY HAVE SEEN THE NOTICE, and the
-- 140-character `ai_requests.prompt_redacted_preview` is question text too. So
-- applying this migration PERMANENTLY DELETES every existing preview whose
-- rider's text may not be kept - which, since the columns above were just
-- added and no rider has seen the notice, is every preview there is. Owner's
-- decision, 2026-09-24, accepting the loss of recent operational preview data.
-- The ai_requests rows, fingerprints and verdicts are kept.
update public.ai_requests r
   set prompt_redacted_preview = null
  from public.ai_requests_unretainable_previews v
 where v.request_id = r.request_id;

-- THE 90-DAY PURGE
--
-- Deletes every text row past its retain_until, and nulls the 140-character
-- redacted preview on ai_requests rows older than 90 days, because that preview
-- is question text too and the notice promises 90 days for every copy. It also
-- nulls every preview whose rider's text may not be kept: the routes still
-- write a preview for everyone until the capture step gates that write, so
-- until then this is what keeps the rule, within a day. The ai_requests rows
-- themselves, their fingerprint and their verdict are kept.
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

  update public.ai_requests r
     set prompt_redacted_preview = null
    from public.ai_requests_unretainable_previews v
   where v.request_id = r.request_id;

  return removed;
end;
$$;

-- The preview half filters every ai_requests row on created_at with no user_id,
-- which the (user_id, created_at) index cannot serve, and /api/health runs the
-- same predicate every 15 minutes under a five-second timeout. The partial
-- index holds only rows that still carry a preview, which the purge keeps to
-- the last 90 days.
create index if not exists ai_requests_preview_created_idx
  on public.ai_requests(created_at)
  where prompt_redacted_preview is not null;

revoke all on function public.purge_expired_ai_request_text() from public, anon, authenticated;
grant execute on function public.purge_expired_ai_request_text() to service_role;

-- The trigger lives in the database with the data, so the promise does not
-- depend on a GitHub schedule that goes quiet after 60 days without a commit,
-- a Vercel plan, or a route being reachable. Whether it actually runs is not
-- taken on trust: /api/health's ai_text_retention check fails when any row is
-- more than 36 hours past its retain_until, or when an ai_requests preview is
-- still set more than 90 days and 36 hours after its created_at, or more than
-- 36 hours after it for a rider whose text may not be kept. A row already
-- waits up to 24 hours for the next daily run, so a single missed run can trip
-- it.
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
