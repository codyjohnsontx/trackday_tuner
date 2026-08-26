-- Column-level UPDATE, which looks like the narrow fix and reopens exactly one
-- column. Nothing a rider does edits their profile directly, so there is no
-- column a migration should be handing them without saying why - and `tier`
-- is the one the whole guard exists to keep out of reach.

grant update (tier) on public.profiles to authenticated;
