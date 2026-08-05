-- The same missing revoke as definer_without_revoke.sql, written the other legal
-- way round.
--
-- Postgres's CREATE FUNCTION option list is order-independent, so
-- `as $$ ... $$ language plpgsql security definer;` declares exactly what putting
-- `security definer` ahead of the body declares. It is not an exotic spelling:
-- `set_updated_at` in 20260422000400 already writes `language plpgsql` after its
-- body.
--
-- A reader that stopped at the opening `$` would see `(p_user_id uuid) returns
-- void as` and nothing else, conclude this is not a `security definer` function,
-- and let a world-executable one through without a word.

create or replace function public.promote_rider(
  p_user_id uuid
)
returns void
as $$
begin
  update public.profiles set plan = 'pro' where id = p_user_id;
end;
$$ language plpgsql security definer set search_path = public;
