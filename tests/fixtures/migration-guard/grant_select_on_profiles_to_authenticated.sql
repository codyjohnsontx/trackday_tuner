-- The control: what 20260719001100 actually grants, and the only privilege a
-- rider needs on this table. The guard must stay quiet about it.

grant select on public.profiles to authenticated;
