-- The other write. A rider holding INSERT can plant a row that reads as text a
-- served request was asked with. Rows are written by the routes through the
-- service client, never by the rider.

grant select, insert, delete on public.ai_request_text to authenticated;
