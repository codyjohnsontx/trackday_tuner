-- The shape the hosted drift fell through, loaded after
-- invoker_without_revoke.sql: that file creates save_rider_note and says nothing
-- about execute, and this later one decides it. A database holding the first and
-- not this one has the function executable by public, and nothing in either file
-- tells whoever applies the first by hand that its grant lives somewhere else.

revoke execute on function public.save_rider_note(uuid, text)
  from public, anon, authenticated;
grant execute on function public.save_rider_note(uuid, text)
  to authenticated;
