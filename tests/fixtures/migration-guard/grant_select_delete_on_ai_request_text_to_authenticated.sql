-- The control: what 20260924001700 grants. A rider may see and delete their own
-- rows, which RLS limits to their own, so the guard has to stay quiet here.

grant select, delete on public.ai_request_text to authenticated;
