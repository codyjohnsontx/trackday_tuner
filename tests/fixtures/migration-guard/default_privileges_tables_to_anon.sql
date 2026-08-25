-- Aimed forward: every table created after this statement arrives readable
-- and writable by anon before its own migration says anything, and a
-- migration that forgets `enable row level security` exposes every row.

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon;
