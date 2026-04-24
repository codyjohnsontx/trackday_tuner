alter table public.ai_requests
  add column if not exists refusal_reason text,
  add column if not exists policy_result text,
  add column if not exists policy_violations text[] not null default '{}',
  add column if not exists prompt_fingerprint text,
  add column if not exists prompt_redacted_preview text,
  add column if not exists classifier_stage text;

create index if not exists ai_requests_user_fingerprint_created_idx
  on public.ai_requests(user_id, prompt_fingerprint, created_at desc);
