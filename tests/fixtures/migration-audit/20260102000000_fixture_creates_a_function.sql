-- Fixture only. See README.md in this directory.
create or replace function public.fixture_widget_count() returns bigint
language sql as $$ select count(*) from public.fixture_widgets $$;
