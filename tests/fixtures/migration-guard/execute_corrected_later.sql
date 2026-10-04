-- Not a violation. Loaded after definer_with_revoke.sql, whose migration already
-- decided execute on promote_rider when it created it. A later migration changing
-- that decision is an ordinary correction: a database that never receives it
-- still holds the function decided, just with the older answer.

grant execute on function public.promote_rider(uuid)
  to authenticated;
