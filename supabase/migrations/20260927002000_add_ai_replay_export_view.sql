-- WHAT THE REPLAY EXPORT MAY READ, stated once. Riders' kept AI question text
-- is exported to Redline, the owner's AI-safety lab, so it can be replayed
-- through new versions of the guards (docs/ai-replay-export.md). The export is
-- `npm run ai:export-replay`, run by the owner with the service key, and it
-- reads this view and nothing else. Phase 2, if Redline ever pulls on its own,
-- gives a dedicated role select on this view, so the rule below is written
-- here rather than in the script: a new reader changes the credential, not the
-- rule or the format.
--
-- A row is exported only while all of this holds:
--
--   * it has not passed its retain_until. The purge deletes a row within a day
--     of that; the view does not wait for it.
--   * its rider is keeping NOW: the notice has been seen, opted_out_at is null
--     and opted_in_at is set. This is the app's opt-in rule
--     (resolveQuestionRetention) and the one 20260926001900 enforces at insert;
--     requires_opt_in is not read, so a false value is never taken as consent.
--     Turning keeping off deletes what is held (20260924001700), so this arm
--     only matters for a row that delete missed.
--   * it was written after the later of notice_seen_at and opted_in_at.
--     Consent is judged as of when the text was written, as in
--     ai_requests_unretainable_previews: text from before the rider's latest
--     opt-in is never exported, even once they have agreed again.
--
-- A rider with no profiles row meets none of it.
--
-- NO user_id, session_id OR vehicle_id. The rider is `rider_key`, a SHA-256 of
-- the user id, which lets the script group one rider's rows. It is NOT the
-- pseudonym the export writes: the script re-keys it with an HMAC under a
-- secret generated per run and discarded, so a rider's pseudonym differs
-- between exports. rider_key itself never leaves the script.
--
-- request_id DOES leave, so the owner can look a verdict up again, and it is
-- not a secret: this database maps it to the account, the rider's app shows it
-- under a Race Engineer answer, and the operational logs record it. It is also
-- the same in every export, so two files would join a rider's two pseudonyms.
-- Only one file is ever kept (docs/ai-replay-export.md); nothing here makes a
-- line anonymous.
--
-- The verdict comes from ai_requests, joined on (request_id, user_id) - the
-- same pair ai_request_text's foreign key names - so a text row can only ever
-- carry its own request's verdict.
--
-- security_invoker so it runs with the caller's privileges and RLS rather than
-- its owner's, like ai_requests_unretainable_previews. It is for the service
-- role alone, and the revoke is explicit because hosted's legacy defaults would
-- otherwise hand it to anon and authenticated.
create or replace view public.ai_replay_export
  with (security_invoker = true)
as
select t.request_id,
       t.route,
       t.created_at,
       t.retain_until,
       t.submitted,
       t.redaction_version,
       encode(sha256(convert_to(t.user_id::text, 'UTF8')), 'hex') as rider_key,
       r.app_commit,
       r.status,
       r.refusal_reason,
       r.policy_result,
       r.policy_violations,
       r.classifier_stage,
       r.model
  from public.ai_request_text t
  join public.ai_requests r
    on r.request_id = t.request_id
   and r.user_id = t.user_id
  join public.profiles p
    on p.id = t.user_id
 where t.retain_until > now()
   and p.ai_question_retention_notice_seen_at is not null
   and p.ai_question_retention_opted_out_at is null
   and p.ai_question_retention_opted_in_at is not null
   and t.created_at >= greatest(p.ai_question_retention_notice_seen_at,
                                p.ai_question_retention_opted_in_at);

revoke all on public.ai_replay_export from public, anon, authenticated;
grant select on public.ai_replay_export to service_role;
