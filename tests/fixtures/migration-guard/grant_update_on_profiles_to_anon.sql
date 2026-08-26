-- A later migration handing anon UPDATE on profiles. RLS admits no row to a
-- caller with no auth.uid(), so this changes nothing an anon request can do
-- today - and the guard still refuses it, because the privilege is the
-- control and the policy is not, and a policy edit is one `create policy`
-- away from making it live.

grant update on public.profiles to anon;
