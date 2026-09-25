-- EVERY RIDER OPTS IN TO QUESTION RETENTION. Owner's decision, 2026-09-25: for
-- the beta, keeping the text of a rider's AI questions is OFF for every rider
-- until they turn it on, and no jurisdiction is detected. It replaces the
-- earlier choice (opt-out for most riders, opt-in for EU and UK signups) that
-- 20260924001700 was written for.
--
-- The keep rule is not rewritten. 20260924001700 states it once, as the
-- ai_requests_unretainable_previews view, and it already has the opt-in arm:
-- a rider whose ai_question_retention_requires_opt_in is true has nothing kept
-- until opted_in_at is set, and only what they write after it. So this makes
-- that column true for every rider - existing rows now, new rows by default -
-- rather than adding a second statement of the rule beside the first. The
-- column stays as schema; a later decision to let some riders keep by default
-- would be a writer of `false`, not a new column.
--
-- Nothing in the app writes the column, and authenticated holds SELECT only on
-- profiles (20260719001100), so no rider can turn it back to false.
alter table public.profiles
  alter column ai_question_retention_requires_opt_in set default true;

update public.profiles
   set ai_question_retention_requires_opt_in = true
 where not ai_question_retention_requires_opt_in;

-- A rider who had seen the notice but never opted in was keeping under the old
-- default and is not now, so their previews just became unretainable. Clear
-- them here, as 20260924001700 did, rather than leaving them to the daily
-- purge: /api/health fails ai_text_retention on an unretainable preview more
-- than 36 hours old. ai_request_text rows are not touched - nothing writes that
-- table yet, and a held row is the rider's to delete from Settings.
update public.ai_requests r
   set prompt_redacted_preview = null
  from public.ai_requests_unretainable_previews v
 where v.request_id = r.request_id;
