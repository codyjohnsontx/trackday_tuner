-- The same, to the pseudo-role. anon and authenticated are members of public,
-- so every future table reaches both through a statement naming neither.

alter default privileges in schema public
  grant all on tables to public;
