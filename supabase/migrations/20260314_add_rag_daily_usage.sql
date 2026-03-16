create table if not exists public.rag_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  request_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table public.rag_daily_usage enable row level security;

revoke all on public.rag_daily_usage from anon, authenticated;

create or replace function public.consume_rag_daily_limit(
  p_user_id uuid,
  p_usage_date date,
  p_limit integer
)
returns table (
  allowed boolean,
  request_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
begin
  insert into public.rag_daily_usage (user_id, usage_date, request_count)
  values (p_user_id, p_usage_date, 0)
  on conflict (user_id, usage_date) do nothing;

  update public.rag_daily_usage
  set request_count = public.rag_daily_usage.request_count + 1,
      updated_at = now()
  where public.rag_daily_usage.user_id = p_user_id
    and public.rag_daily_usage.usage_date = p_usage_date
    and public.rag_daily_usage.request_count < p_limit
  returning public.rag_daily_usage.request_count into current_count;

  if current_count is not null then
    return query select true, current_count;
    return;
  end if;

  select public.rag_daily_usage.request_count
  into current_count
  from public.rag_daily_usage
  where public.rag_daily_usage.user_id = p_user_id
    and public.rag_daily_usage.usage_date = p_usage_date;

  return query select false, coalesce(current_count, p_limit);
end;
$$;

revoke all on function public.consume_rag_daily_limit(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.consume_rag_daily_limit(uuid, date, integer) to service_role;
