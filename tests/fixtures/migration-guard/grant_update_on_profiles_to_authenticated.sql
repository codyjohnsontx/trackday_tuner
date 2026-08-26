-- The exact statement that reopens the escalation: a rider holding UPDATE on
-- their own row can set tier, beta_access_expires_at and the Stripe
-- identifiers on it, because RLS chooses the row and cannot restrict the
-- column. The hosted project answered this shape with 200 on 2026-08-25.

grant update on public.profiles to authenticated;
