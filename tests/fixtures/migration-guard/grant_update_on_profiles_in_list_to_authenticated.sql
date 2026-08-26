-- profiles buried in a multi-table grant list. The update reaches the profiles
-- row exactly as a single-table grant would; a guard that only reads profiles
-- when it sits alone immediately before TO would pass this while reopening the
-- entitlement columns.

grant update on public.profiles, public.vehicles to authenticated;
