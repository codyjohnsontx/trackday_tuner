create table if not exists public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  request_id text not null,
  status text not null,
  model text,

  prompt_tokens integer,
  completion_tokens integer,
  latency_ms integer,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists ai_requests_user_created_idx
  on public.ai_requests(user_id, created_at desc);

create unique index if not exists ai_requests_request_id_key
  on public.ai_requests(request_id);

alter table public.ai_requests enable row level security;

create policy "ai_requests: select own"
  on public.ai_requests for select
  using (auth.uid() = user_id);
