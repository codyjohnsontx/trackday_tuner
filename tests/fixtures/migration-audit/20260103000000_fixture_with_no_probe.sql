-- Fixture only. See README.md in this directory. This one is deliberately
-- absent from the probe map used by the test: it is what an eighteenth
-- migration looks like to the generator.
create table if not exists public.fixture_unprobed (id uuid primary key);
