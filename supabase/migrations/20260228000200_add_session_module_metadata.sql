alter table public.sessions
  add column if not exists session_number smallint;

alter table public.sessions
  add column if not exists enabled_modules jsonb not null default '{}'::jsonb;
