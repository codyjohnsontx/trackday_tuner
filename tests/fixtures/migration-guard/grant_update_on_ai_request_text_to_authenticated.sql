-- The hazard the rider-text check exists for. RLS picks the row and cannot
-- restrict the column, so a rider holding UPDATE on their own row can push
-- `retain_until` past 90 days and keep text the notice promises to delete, or
-- rewrite `submitted` so the verdict recorded against a request describes a
-- question that was never asked.

grant select, update, delete on public.ai_request_text to authenticated;
