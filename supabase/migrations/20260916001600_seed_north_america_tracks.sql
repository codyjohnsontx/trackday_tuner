-- Give the Tracks feature something to be about, and give a circuit an identity
-- that survives being spelled differently.
--
-- Nothing in this repository ever wrote a row to `public.tracks`. `is_seeded`
-- has existed since the baseline and the tracks page has always had a SEEDED
-- TRACKS section, and on a database built from these migrations both were
-- empty - so every rider typed their circuit out by hand, and the New Session
-- typeahead had nothing to offer them.
--
-- `resolveSessionTrack` (lib/actions/sessions.ts) already turns a typed name
-- into a row, so the season did not go unrecorded. It went recorded TWICE:
-- `findSavedTrackByName` folds case, spacing and accent composition and nothing
-- else, so "Circuit of the Americas" in April and "COTA" in May are two
-- circuits. Reproduced on a stack built from this directory, that is exactly
-- what happens - two custom tracks, two of a free rider's three slots, and a
-- season that groups under neither.
--
-- WHERE THE DATA CAME FROM
--
-- Circuit names, countries and the administrative areas behind `location` are
-- from Wikidata, dedicated to the public domain under CC0 1.0, which permits
-- redistribution in a commercial product with no attribution obligation. Each
-- row carries the Q-id it was read from so any figure can be checked. Nothing
-- was scraped: the entities were read from Wikidata's own query service and
-- Special:EntityData.
--
-- Layout names and aliases are NOT from Wikidata, which records neither
-- usefully - its length statements carry no configuration names at all. They
-- are compiled by hand from the configuration and former names each circuit
-- publishes for itself. They are facts about naming rather than anyone's
-- expression, and no proprietary circuit database was consulted or copied.
--
-- WHAT WAS LEFT OUT, on purpose
--
-- North America only, which is the scope this was asked for. Road courses that
-- run track days: ovals, drag strips and street circuits are absent unless the
-- venue also runs a road course riders lap. Circuits that have closed are
-- absent - MSR Houston was in the working set and was dropped, because a
-- seeded circuit nobody can ride is worse than an absent one. Wikidata has no
-- entity for several venues riders do use (GingerMan, Grattan, High Plains,
-- Inde Motorsports Ranch), so they are absent rather than sourced from
-- somewhere this file cannot name. `location` is null for seven circuits whose
-- Wikidata entity records no administrative area; it is display text and
-- nothing keys on it.
--
-- Some of what IS here is coarser than a rider would write. Wikidata places
-- Laguna Seca in "Monterey County" and Watkins Glen in "Dix", because those are
-- the administrative areas its entities name. Carrying that through is the
-- price of every figure being checkable against a Q-id, and is preferred to
-- improving the text by hand where nothing could then verify it.

-- tracks.slug is what makes a seeded circuit the same circuit across a reseed.
-- Without it, the only key this insert could conflict on is `name`, which is the
-- thing a later correction is most likely to change - so a circuit renamed
-- upstream would arrive as a second row and split the very histories this file
-- exists to join. A rider's own track has no slug, and the index is partial so
-- that "no slug" never collides with itself.
alter table public.tracks add column if not exists slug text;

create unique index if not exists tracks_slug_key
  on public.tracks(slug)
  where slug is not null;

-- A circuit configuration is a layout of one track, not a track of its own.
-- MotorSport Ranch at Cresson runs three; seeding them as three circuits would
-- mean a rider's Cresson season lived in three places and compared against
-- nothing. `sessions.layout_id` below is nullable, so a rider who does not care
-- which configuration they ran never has to answer.
create table if not exists public.track_layouts (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  slug text not null,
  name text not null,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint track_layouts_track_slug_key unique (track_id, slug)
);

create index if not exists track_layouts_track_id_idx
  on public.track_layouts(track_id, sort_order);

alter table public.track_layouts enable row level security;

-- A layout is exactly as visible as the track it belongs to. Repeating the
-- track policy's own condition here rather than restating `is_seeded or
-- auth.uid() = created_by` keeps the two from drifting apart.
drop policy if exists "track_layouts: select with the track" on public.track_layouts;
create policy "track_layouts: select with the track"
  on public.track_layouts for select
  using (
    exists (
      select 1 from public.tracks t
      where t.id = track_layouts.track_id
        and (t.is_seeded or auth.uid() = t.created_by)
    )
  );

-- The other spellings of one circuit. This is the identity half: a rider typing
-- "Mosport" and a rider typing "Canadian Tire Motorsport Park" have named the
-- same place, and no amount of case and whitespace folding will ever say so.
create table if not exists public.track_aliases (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now()
);

-- One alias, one circuit. The expression is lib/session-track.ts's
-- `trackNameKey` written in SQL - NFC, trimmed, runs of whitespace collapsed,
-- lowercased - so an alias that folds onto another is refused when this file is
-- applied rather than discovered later as a circuit that resolves two ways.
-- "AMP" is the near miss that made this an index and not a comment: it is
-- Atlanta Motorsports Park to one rider and Atlantic Motorsport Park to
-- another, so it is an alias for neither.
create unique index if not exists track_aliases_folded_alias_key
  on public.track_aliases (
    (lower(regexp_replace(btrim(normalize(alias, NFC)), '\s+', ' ', 'g')))
  );

create index if not exists track_aliases_track_id_idx
  on public.track_aliases(track_id);

alter table public.track_aliases enable row level security;

drop policy if exists "track_aliases: select with the track" on public.track_aliases;
create policy "track_aliases: select with the track"
  on public.track_aliases for select
  using (
    exists (
      select 1 from public.tracks t
      where t.id = track_aliases.track_id
        and (t.is_seeded or auth.uid() = t.created_by)
    )
  );

-- Which configuration the session ran, mirroring track_id/track_name: the id is
-- what groups sessions, the name is what the session still reads as after the
-- layout row it came from is gone. `on delete set null` is why both exist - see
-- the same pair on sessions.track_id in the baseline.
alter table public.sessions add column if not exists layout_id uuid
  references public.track_layouts(id) on delete set null;
alter table public.sessions add column if not exists layout_name text;

-- The foreign key proves a layout EXISTS, not that it belongs to the session's
-- circuit, and `authenticated` writes `sessions` directly - RLS picks the row,
-- not what its columns say. So a direct write could file a VIR session under a
-- Cresson layout, bypassing the scoped lookup in `createSession`. This makes the
-- pairing a database fact, and makes `layout_name` the layout row's own name
-- whenever an id is set, exactly as the application canonicalises it.
--
-- `security invoker`, so the lookup runs under the caller's RLS and a layout the
-- rider cannot see is refused like one that does not exist. Not a
-- `security definer` function, so execute is not the access control here.
--
-- A session with no circuit loses its layout id rather than being refused,
-- because that is how the cascades arrive: deleting a track sets
-- `sessions.track_id` null and deletes its layouts, which sets `layout_id` null,
-- in an order this function does not choose - refusing would make the track
-- delete fail. `layout_name` is left alone whenever `layout_id` is null, since it
-- is the snapshot that outlives the layout row.
create or replace function public.sessions_check_layout()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  layout_track_id uuid;
  layout_row_name text;
begin
  if new.layout_id is null then
    return new;
  end if;

  if new.track_id is null then
    new.layout_id := null;
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.layout_id is not distinct from old.layout_id
    and new.track_id is not distinct from old.track_id
    and new.layout_name is not distinct from old.layout_name then
    return new;
  end if;

  select l.track_id, l.name
    into layout_track_id, layout_row_name
    from public.track_layouts l
   where l.id = new.layout_id;

  if not found or layout_track_id is distinct from new.track_id then
    raise exception 'layout % is not a layout of track %', new.layout_id, new.track_id
      using errcode = '23514';
  end if;

  new.layout_name := layout_row_name;
  return new;
end;
$$;

drop trigger if exists sessions_check_layout on public.sessions;
create trigger sessions_check_layout
  before insert or update of layout_id, track_id, layout_name on public.sessions
  for each row execute function public.sessions_check_layout();

-- Grants, per table and per role, as 20260719001100 requires of every table a
-- later migration adds. Both tables are reference data the application only
-- reads: a rider names a circuit through sessions.track_name, never by writing
-- an alias, and an insert privilege here would let one rider's row decide which
-- circuit another rider's typing resolves to. service_role reaches both through
-- the default privileges that file set.
grant select on public.track_layouts to authenticated;
grant select on public.track_aliases to authenticated;

-- tracks
insert into public.tracks (slug, name, location, is_seeded, created_by) values
  ('area-27-motorsports-park', 'Area 27 Motorsports Park', 'Canada', true, null),  -- wikidata:Q125868149
  ('arroyo-seco-raceway', 'Arroyo Seco Raceway', 'New Mexico', true, null),  -- wikidata:Q4796260
  ('atlanta-motorsports-park', 'Atlanta Motorsports Park', null, true, null),  -- wikidata:Q16162216
  ('atlantic-motorsport-park', 'Atlantic Motorsport Park', 'Nova Scotia, Canada', true, null),  -- wikidata:Q4816494
  ('autobahn-country-club', 'Autobahn Country Club', 'Illinois', true, null),  -- wikidata:Q4826158
  ('autodromo-hermanos-rodriguez', 'Autódromo Hermanos Rodríguez', 'Iztacalco, Mexico', true, null),  -- wikidata:Q173099
  ('barber-motorsports-park', 'Barber Motorsports Park', 'Alabama', true, null),  -- wikidata:Q807806
  ('blackhawk-farms-raceway', 'Blackhawk Farms Raceway', 'Illinois', true, null),  -- wikidata:Q4922956
  ('brainerd-international-raceway', 'Brainerd International Raceway', 'Brainerd, Minnesota', true, null),  -- wikidata:Q897426
  ('buttonwillow-raceway-park', 'Buttonwillow Raceway Park', 'California', true, null),  -- wikidata:Q5003115
  ('calabogie-motorsports-park', 'Calabogie Motorsports Park', 'Ontario, Canada', true, null),  -- wikidata:Q14875114
  ('canadian-tire-motorsport-park', 'Canadian Tire Motorsport Park', 'Bowmanville, Ontario, Canada', true, null),  -- wikidata:Q171570
  ('carolina-motorsports-park', 'Carolina Motorsports Park', 'Kershaw, South Carolina', true, null),  -- wikidata:Q136620274
  ('chuckwalla-valley-raceway', 'Chuckwalla Valley Raceway', null, true, null),  -- wikidata:Q122056028
  ('circuit-icar', 'Circuit ICAR', 'Quebec, Canada', true, null),  -- wikidata:Q16258391
  ('circuit-mont-tremblant', 'Circuit Mont-Tremblant', 'Quebec, Canada', true, null),  -- wikidata:Q172873
  ('circuit-of-the-americas', 'Circuit of the Americas', 'Austin, Texas', true, null),  -- wikidata:Q59626
  ('daytona-international-speedway', 'Daytona International Speedway', 'Daytona Beach, Florida', true, null),  -- wikidata:Q1179250
  ('dominion-raceway', 'Dominion Raceway', null, true, null),  -- wikidata:Q19877925
  ('eagles-canyon-raceway', 'Eagles Canyon Raceway', 'Decatur, Texas', true, null),  -- wikidata:Q116619972
  ('hallett-motor-racing-circuit', 'Hallett Motor Racing Circuit', 'Oklahoma', true, null),  -- wikidata:Q5642923
  ('harris-hill-raceway', 'Harris Hill Raceway', 'San Marcos, Texas', true, null),  -- wikidata:Q115046013
  ('homestead-miami-speedway', 'Homestead-Miami Speedway', 'Homestead, Florida', true, null),  -- wikidata:Q1626077
  ('indianapolis-motor-speedway', 'Indianapolis Motor Speedway', 'Speedway, Indiana', true, null),  -- wikidata:Q172732
  ('lime-rock-park', 'Lime Rock Park', 'Salisbury, Connecticut', true, null),  -- wikidata:Q940069
  ('mid-ohio-sports-car-course', 'Mid-Ohio Sports Car Course', 'Ohio', true, null),  -- wikidata:Q1931770
  ('mission-raceway-park', 'Mission Raceway Park', 'British Columbia, Canada', true, null),  -- wikidata:Q6878681
  ('monticello-motor-club', 'Monticello Motor Club', null, true, null),  -- wikidata:Q123762988
  ('motorsport-ranch', 'MotorSport Ranch', 'Cresson, Texas', true, null),  -- wikidata:Q116579634
  ('nola-motorsports-park', 'NOLA Motorsports Park', 'Avondale, Louisiana', true, null),  -- wikidata:Q6954900
  ('new-jersey-motorsports-park', 'New Jersey Motorsports Park', null, true, null),  -- wikidata:Q16982553
  ('ozarks-international-raceway', 'Ozarks International Raceway', null, true, null),  -- wikidata:Q111950375
  ('pacific-raceways', 'Pacific Raceways', 'Washington', true, null),  -- wikidata:Q7122643
  ('pittsburgh-international-race-complex', 'Pittsburgh International Race Complex', 'Big Beaver, Pennsylvania', true, null),  -- wikidata:Q38250527
  ('portland-international-raceway', 'Portland International Raceway', 'Portland, Oregon', true, null),  -- wikidata:Q2662150
  ('road-america', 'Road America', 'Plymouth, Wisconsin', true, null),  -- wikidata:Q648512
  ('road-atlanta', 'Road Atlanta', 'Georgia', true, null),  -- wikidata:Q964148
  ('roebling-road-raceway', 'Roebling Road Raceway', 'Georgia', true, null),  -- wikidata:Q7357548
  ('sebring-international-raceway', 'Sebring International Raceway', 'Highlands County, Florida', true, null),  -- wikidata:Q172883
  ('shannonville-motorsport-park', 'Shannonville Motorsport Park', 'Tyendinaga, Ontario, Canada', true, null),  -- wikidata:Q7488996
  ('sonoma-raceway', 'Sonoma Raceway', 'Sonoma, California', true, null),  -- wikidata:Q112563
  ('summit-point-motorsports-park', 'Summit Point Motorsports Park', 'West Virginia', true, null),  -- wikidata:Q7637854
  ('the-ridge-motorsports-park', 'The Ridge Motorsports Park', null, true, null),  -- wikidata:Q16901548
  ('the-thermal-club', 'The Thermal Club', 'Thermal, California', true, null),  -- wikidata:Q125156625
  ('thunderhill-raceway-park', 'Thunderhill Raceway Park', 'Glenn County, California', true, null),  -- wikidata:Q7799154
  ('utah-motorsports-campus', 'Utah Motorsports Campus', 'Grantsville, Utah', true, null),  -- wikidata:Q691587
  ('virginia-international-raceway', 'Virginia International Raceway', 'Virginia', true, null),  -- wikidata:Q847633
  ('watkins-glen-international', 'Watkins Glen International', 'Dix, New York', true, null),  -- wikidata:Q171449
  ('weathertech-raceway-laguna-seca', 'WeatherTech Raceway Laguna Seca', 'Monterey County, California', true, null),  -- wikidata:Q1423481
  ('willow-springs-international-motorsports-park', 'Willow Springs International Motorsports Park', 'Kern County, California', true, null)  -- wikidata:Q8022368
on conflict (slug) where slug is not null do update
  set name = excluded.name,
      location = excluded.location,
      is_seeded = true;

-- layouts
insert into public.track_layouts (track_id, slug, name, sort_order)
select t.id, v.slug, v.name, v.sort_order
  from (values
    ('autobahn-country-club', 'full-course', 'Full Course', 0::smallint),
    ('autobahn-country-club', 'north-course', 'North Course', 1::smallint),
    ('autobahn-country-club', 'south-course', 'South Course', 2::smallint),
    ('buttonwillow-raceway-park', 'config-13-cw', 'Config 13 Clockwise', 0::smallint),
    ('buttonwillow-raceway-park', 'config-13-ccw', 'Config 13 Counter-Clockwise', 1::smallint),
    ('canadian-tire-motorsport-park', 'grand-prix-circuit', 'Grand Prix Circuit', 0::smallint),
    ('canadian-tire-motorsport-park', 'driver-development-track', 'Driver Development Track', 1::smallint),
    ('canadian-tire-motorsport-park', 'advanced-circuit', 'Advanced Circuit', 2::smallint),
    ('daytona-international-speedway', 'road-course', 'Road Course', 0::smallint),
    ('daytona-international-speedway', 'oval', 'Oval', 1::smallint),
    ('homestead-miami-speedway', 'road-course', 'Road Course', 0::smallint),
    ('homestead-miami-speedway', 'oval', 'Oval', 1::smallint),
    ('indianapolis-motor-speedway', 'grand-prix-circuit', 'Grand Prix Circuit', 0::smallint),
    ('indianapolis-motor-speedway', 'oval', 'Oval', 1::smallint),
    ('mid-ohio-sports-car-course', 'full-course', 'Full Course', 0::smallint),
    ('mid-ohio-sports-car-course', 'club-course', 'Club Course', 1::smallint),
    ('motorsport-ranch', '1-7-mile', '1.7-Mile', 0::smallint),
    ('motorsport-ranch', '1-3-mile', '1.3-Mile', 1::smallint),
    ('motorsport-ranch', '3-1-mile', '3.1-Mile', 2::smallint),
    ('new-jersey-motorsports-park', 'thunderbolt', 'Thunderbolt', 0::smallint),
    ('new-jersey-motorsports-park', 'lightning', 'Lightning', 1::smallint),
    ('shannonville-motorsport-park', 'pro-track', 'Pro Track', 0::smallint),
    ('shannonville-motorsport-park', 'nelson', 'Nelson', 1::smallint),
    ('shannonville-motorsport-park', 'fabi', 'Fabi', 2::smallint),
    ('shannonville-motorsport-park', 'long-track', 'Long Track', 3::smallint),
    ('sonoma-raceway', 'long-course', 'Long Course', 0::smallint),
    ('sonoma-raceway', 'nascar-course', 'NASCAR Course', 1::smallint),
    ('summit-point-motorsports-park', 'main-circuit', 'Main Circuit', 0::smallint),
    ('summit-point-motorsports-park', 'shenandoah-circuit', 'Shenandoah Circuit', 1::smallint),
    ('summit-point-motorsports-park', 'jefferson-circuit', 'Jefferson Circuit', 2::smallint),
    ('thunderhill-raceway-park', '3-mile', '3-Mile', 0::smallint),
    ('thunderhill-raceway-park', '2-mile', '2-Mile', 1::smallint),
    ('thunderhill-raceway-park', '5-mile', '5-Mile', 2::smallint),
    ('utah-motorsports-campus', 'full-course', 'Full Course', 0::smallint),
    ('utah-motorsports-campus', 'east-course', 'East Course', 1::smallint),
    ('utah-motorsports-campus', 'west-course', 'West Course', 2::smallint),
    ('utah-motorsports-campus', 'outer-course', 'Outer Course', 3::smallint),
    ('virginia-international-raceway', 'full-course', 'Full Course', 0::smallint),
    ('virginia-international-raceway', 'north-course', 'North Course', 1::smallint),
    ('virginia-international-raceway', 'south-course', 'South Course', 2::smallint),
    ('virginia-international-raceway', 'grand-course', 'Grand Course', 3::smallint),
    ('virginia-international-raceway', 'patriot-course', 'Patriot Course', 4::smallint),
    ('watkins-glen-international', 'long-course', 'Long Course', 0::smallint),
    ('watkins-glen-international', 'short-course', 'Short Course', 1::smallint),
    ('willow-springs-international-motorsports-park', 'big-willow', 'Big Willow', 0::smallint),
    ('willow-springs-international-motorsports-park', 'streets-of-willow', 'Streets of Willow', 1::smallint),
    ('willow-springs-international-motorsports-park', 'horse-thief-mile', 'Horse Thief Mile', 2::smallint)
  ) as v(track_slug, slug, name, sort_order)
  join public.tracks t on t.slug = v.track_slug
on conflict (track_id, slug) do update
  set name = excluded.name,
      sort_order = excluded.sort_order;

-- aliases
insert into public.track_aliases (track_id, alias)
select t.id, v.alias
  from (values
    ('area-27-motorsports-park', 'Area 27'),
    ('arroyo-seco-raceway', 'Arroyo Seco'),
    ('autobahn-country-club', 'Autobahn'),
    ('autodromo-hermanos-rodriguez', 'Autodromo Hermanos Rodriguez'),
    ('autodromo-hermanos-rodriguez', 'Hermanos Rodriguez'),
    ('barber-motorsports-park', 'Barber'),
    ('blackhawk-farms-raceway', 'Blackhawk Farms'),
    ('brainerd-international-raceway', 'Brainerd'),
    ('brainerd-international-raceway', 'BIR'),
    ('buttonwillow-raceway-park', 'Buttonwillow'),
    ('calabogie-motorsports-park', 'Calabogie'),
    ('canadian-tire-motorsport-park', 'Mosport'),
    ('canadian-tire-motorsport-park', 'Mosport International Raceway'),
    ('canadian-tire-motorsport-park', 'CTMP'),
    ('carolina-motorsports-park', 'CMP'),
    ('chuckwalla-valley-raceway', 'Chuckwalla'),
    ('circuit-icar', 'ICAR'),
    ('circuit-mont-tremblant', 'Mont-Tremblant'),
    ('circuit-mont-tremblant', 'Le Circuit Mont-Tremblant'),
    ('circuit-mont-tremblant', 'St. Jovite'),
    ('circuit-of-the-americas', 'COTA'),
    ('daytona-international-speedway', 'Daytona'),
    ('dominion-raceway', 'Dominion'),
    ('eagles-canyon-raceway', 'Eagles Canyon'),
    ('hallett-motor-racing-circuit', 'Hallett'),
    ('harris-hill-raceway', 'Harris Hill'),
    ('harris-hill-raceway', 'H2R'),
    ('homestead-miami-speedway', 'Homestead'),
    ('indianapolis-motor-speedway', 'Indianapolis'),
    ('indianapolis-motor-speedway', 'Indy'),
    ('indianapolis-motor-speedway', 'The Brickyard'),
    ('lime-rock-park', 'Lime Rock'),
    ('mid-ohio-sports-car-course', 'Mid-Ohio'),
    ('mid-ohio-sports-car-course', 'Mid Ohio'),
    ('mission-raceway-park', 'Mission Raceway'),
    ('monticello-motor-club', 'Monticello'),
    ('motorsport-ranch', 'MSR Cresson'),
    ('motorsport-ranch', 'MotorSport Ranch Cresson'),
    ('nola-motorsports-park', 'NOLA'),
    ('new-jersey-motorsports-park', 'NJMP'),
    ('ozarks-international-raceway', 'Ozarks'),
    ('pacific-raceways', 'Seattle International Raceway'),
    ('pittsburgh-international-race-complex', 'Pitt Race'),
    ('pittsburgh-international-race-complex', 'BeaveRun Motorsports Complex'),
    ('portland-international-raceway', 'Portland International'),
    ('road-america', 'Elkhart Lake'),
    ('road-atlanta', 'Michelin Raceway Road Atlanta'),
    ('roebling-road-raceway', 'Roebling Road'),
    ('sebring-international-raceway', 'Sebring'),
    ('shannonville-motorsport-park', 'Shannonville'),
    ('sonoma-raceway', 'Sears Point'),
    ('sonoma-raceway', 'Sears Point Raceway'),
    ('sonoma-raceway', 'Infineon Raceway'),
    ('summit-point-motorsports-park', 'Summit Point'),
    ('the-ridge-motorsports-park', 'The Ridge'),
    ('the-thermal-club', 'Thermal Club'),
    ('thunderhill-raceway-park', 'Thunderhill'),
    ('utah-motorsports-campus', 'Miller Motorsports Park'),
    ('virginia-international-raceway', 'VIR'),
    ('watkins-glen-international', 'Watkins Glen'),
    ('watkins-glen-international', 'The Glen'),
    ('weathertech-raceway-laguna-seca', 'Laguna Seca'),
    ('weathertech-raceway-laguna-seca', 'Mazda Raceway Laguna Seca'),
    ('willow-springs-international-motorsports-park', 'Willow Springs')
  ) as v(track_slug, alias)
  join public.tracks t on t.slug = v.track_slug
on conflict do nothing;
