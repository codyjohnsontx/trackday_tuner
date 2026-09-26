-- CAPTURE RE-CHECKS THE KEEP RULE WHEN IT WRITES. Owner's decision, 2026-09-25.
--
-- The routes decide whether to keep a rider's text from the profile they read
-- at the start of the request, and write the text row and the preview a few
-- queries later. A rider who turns keeping off in between - "Do not keep" in
-- another tab, or "Not now" on the notice while a question is in flight - has
-- had everything held deleted by then, and the late row would outlive that
-- delete for 90 days. So the database asks again at insert:
--
--   ai_request_text  the row is dropped unless the rider is keeping now.
--   ai_requests      the preview is written as null unless the rider is
--                    keeping now. The row itself always goes in: it is the
--                    rate limit.
--
-- "Keeping now" is the app's opt-in rule (resolveQuestionRetention): the
-- notice has been seen, opted_out_at is null and opted_in_at is set.
-- requires_opt_in is not read, so a false value is never taken as consent. A
-- rider with no profiles row keeps nothing.
--
-- The profile row is read FOR SHARE. A rider's switch is an UPDATE of that row,
-- so either the switch commits first and this insert reads the new value, or
-- this insert holds the row until it commits and the switch - and the delete
-- that follows it - waits for it and then sees the row. Without the lock a
-- capture could read the old value, the switch and its delete could run, and
-- the capture would commit after them.
--
-- security invoker: the routes insert as service_role, which may read and lock
-- profiles. A role that could not would fail the insert rather than keep text.
create or replace function public.enforce_rider_text_keep_rule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
     from public.profiles p
    where p.id = new.user_id
      and p.ai_question_retention_notice_seen_at is not null
      and p.ai_question_retention_opted_out_at is null
      and p.ai_question_retention_opted_in_at is not null
      for share;

  if found then
    return new;
  end if;

  if tg_table_name = 'ai_requests' then
    new.prompt_redacted_preview := null;
    return new;
  end if;

  return null;
end;
$$;

create or replace trigger ai_request_text_enforce_keep_rule
  before insert on public.ai_request_text
  for each row execute function public.enforce_rider_text_keep_rule();

create or replace trigger ai_requests_enforce_keep_rule
  before insert on public.ai_requests
  for each row
  when (new.prompt_redacted_preview is not null)
  execute function public.enforce_rider_text_keep_rule();
