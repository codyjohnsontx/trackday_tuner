-- The digital service book, slice 1: one book per bike, its maintenance items,
-- the entries a rider logs against them, the edit history of every entry, and
-- the hour-meter / odometer readings the due math will read.
--
-- Owner decisions, 2026-10-08 (the service book grill). The ones this schema
-- carries:
--
-- - HONEST HISTORY. An entry records when it was actually logged, apart from the
--   service date the rider types. `logged_at` is the server's clock and nothing
--   a rider sends can move it: it is not in the columns `authenticated` may
--   insert or update, and a trigger pins it on insert and keeps it on every
--   update, so even the service role cannot date an entry ahead or behind.
--   `logged_by` is the rider's own id on a rider's insert and is kept on every
--   update; the service role, which has no rider, supplies it on insert. A buyer
--   reads a back-filled entry labelled as back-filled, worked out from these two
--   dates.
-- - EDITS ARE KEPT. Every change to an entry, its items or its parts writes a
--   snapshot to `service_entry_revisions`, from a trigger, so a write through
--   PostgREST cannot skip the record. A rider reads their history and writes
--   none of it; not even the service role may change or remove a revision.
--   One transaction is one revision: an entry saved together with its items is
--   revision 1, not three, so "edited N times" counts edits a rider made.
-- - DELETE IS SOFT. A rider removes an entry by setting `deleted_at`, which
--   writes a `deleted` revision; `delete` is granted to no API role, the service
--   role included, so an entry is hard-deleted only by a cascade: its vehicle's,
--   or its book's, which the service role can still delete. The buyer's view will
--   show "N entries removed by the owner" without the content.
-- - THE RIDER SHAPES THE BOOK. `service_book_fields` is the entry layout a rider
--   adjusts - built-in fields switched off, custom fields added - and custom
--   values live in `service_entries.custom_fields`, keyed by field id.
-- - READINGS ARE THE TRUTH. An entry carrying a reading also writes a
--   `vehicle_readings` row (`source = 'entry'`), through a trigger, so the usage
--   math has one table to read; estimates from logged sessions are only the
--   fallback between readings and are not stored here. A rider's own reading is
--   never changed: a correction is a new reading naming the one it
--   `supersedes_id`, so the old value stays in the history, and the bike's usage
--   is the latest reading nothing supersedes.
--
-- OWNERSHIP RUNS THROUGH THE BOOK, NOT A user_id. A book belongs to whoever owns
-- its vehicle, and every child row reaches that through `service_book_owned`,
-- written once so every policy reads the same rule. It and
-- `service_entry_owned` are security invoker, so RLS on `vehicles` still applies
-- inside them and the grant is not the access control.
--
-- SHAPED FOR A LATER TRANSFER, WHICH THIS DOES NOT BUILD. The owner's rule
-- (2026-10-08): at handover the bike's history is COPIED to the buyer, the
-- seller keeps theirs, and after that the two copies diverge. So a book is never
-- moved between riders; the buyer gets a new book on their own vehicle row,
-- `transferred_from_book_id` and `transferred_at` say where it came from, a
-- copied entry carries `copied_from_entry_id`, and a reading carried over is
-- `source = 'transfer'`. None of those is writable by a rider; on
-- `service_books` that is the grants alone, with no pin, so the service role
-- can set a book's transfer origin. For the copy to
-- keep the seller's dates honest, the pins below apply to the Data API roles
-- only: a function running as the owner (the transfer's `security definer`
-- copy) may carry `logged_at`, `logged_by` and `read_at` forward unchanged.
-- `logged_by` and `changed_by` have no foreign key to auth.users for the same
-- reason: the seller deleting their account must not take the buyer's copy with
-- it.
--
-- Grants are per column where a column is a claim about the record rather than
-- the rider's own data, because RLS chooses the row and never the column (the
-- `profiles` argument, CLAUDE.md). Every table revokes from public, anon and
-- authenticated first, because the hosted project still carries Supabase's
-- legacy `grant all` defaults. anon gets nothing.

-- THE BOOK

create table if not exists public.service_books (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null unique references public.vehicles(id) on delete cascade,
  tracks_hours boolean not null default true,
  tracks_distance boolean not null default false,
  distance_unit text not null default 'mi' check (distance_unit in ('mi', 'km')),
  default_session_minutes integer not null default 20 check (default_session_minutes > 0),
  default_session_distance numeric check (default_session_distance >= 0),
  transferred_from_book_id uuid references public.service_books(id) on delete set null,
  transferred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The entry layout a rider adjusts (owner, Q3). A built-in field is one of the
-- entry's own columns and has its shape already, so it carries no field_type; a
-- custom field is the rider's own and must say what it holds.
create table if not exists public.service_book_fields (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.service_books(id) on delete cascade,
  builtin_key text check (builtin_key in ('reading', 'performed_by', 'shop_name', 'cost', 'parts', 'notes', 'attachments')),
  label text not null check (length(btrim(label)) > 0),
  field_type text check (field_type in ('text', 'number', 'money', 'choice', 'date')),
  options jsonb check (options is null or jsonb_typeof(options) = 'array'),
  enabled boolean not null default true,
  required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_book_fields_type_matches_kind
    check ((builtin_key is null) = (field_type is not null)),
  constraint service_book_fields_builtin_once unique (book_id, builtin_key)
);

-- The maintenance items a book tracks. Starter items (lib/service-book/starter-items.ts)
-- ship with no intervals; the rider types them, or a later slice reads them off
-- a photographed manual page. Archived rather than deleted, because entries name
-- them.
create table if not exists public.service_items (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.service_books(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  interval_hours numeric check (interval_hours > 0),
  interval_distance numeric check (interval_distance > 0),
  interval_days integer check (interval_days > 0),
  source text not null default 'typed' check (source in ('starter', 'typed', 'manual_photo')),
  source_attachment_id uuid,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_items_book_idx on public.service_items(book_id);

-- ENTRIES

create table if not exists public.service_entries (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.service_books(id) on delete cascade,
  service_date date not null,
  reading_hours numeric check (reading_hours >= 0),
  reading_distance numeric check (reading_distance >= 0),
  performed_by text check (performed_by in ('self', 'shop')),
  shop_name text,
  cost_cents integer check (cost_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  notes text,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  origin text not null default 'typed' check (origin in ('typed', 'photo_draft')),
  logged_at timestamptz not null default now(),
  logged_by uuid not null,
  revision integer not null default 1,
  deleted_at timestamptz,
  copied_from_entry_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_entries_book_date_idx
  on public.service_entries(book_id, service_date desc);

-- One row per item an entry covers; each is what resets that item's interval.
-- `label` is the item's name as it was when logged, so the history reads the
-- same after a rename, and is the whole item when `item_id` is null (free text).
create table if not exists public.service_entry_items (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.service_entries(id) on delete cascade,
  item_id uuid references public.service_items(id) on delete set null,
  label text not null check (length(btrim(label)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists service_entry_items_entry_idx on public.service_entry_items(entry_id);
create index if not exists service_entry_items_item_idx on public.service_entry_items(item_id);

create table if not exists public.service_entry_parts (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.service_entries(id) on delete cascade,
  entry_item_id uuid references public.service_entry_items(id) on delete set null,
  brand text,
  part_number text,
  quantity numeric check (quantity > 0),
  unit_cost_cents integer check (unit_cost_cents >= 0),
  created_at timestamptz not null default now()
);

create index if not exists service_entry_parts_entry_idx on public.service_entry_parts(entry_id);

-- Append-only. `snapshot` is the entry row with its items and parts as they
-- stood after the change. `transaction_id` is what folds every write of one
-- transaction into one revision.
create table if not exists public.service_entry_revisions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.service_entries(id) on delete cascade,
  revision integer not null,
  kind text not null check (kind in ('created', 'edited', 'deleted', 'restored', 'transferred')),
  snapshot jsonb not null,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  transaction_id bigint not null,
  constraint service_entry_revisions_once unique (entry_id, revision)
);

-- READINGS

create table if not exists public.vehicle_readings (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.service_books(id) on delete cascade,
  reading_date date not null,
  read_at timestamptz not null default now(),
  hours numeric check (hours >= 0),
  distance numeric check (distance >= 0),
  source text not null default 'rider' check (source in ('rider', 'entry', 'transfer')),
  entry_id uuid unique references public.service_entries(id) on delete cascade,
  supersedes_id uuid unique references public.vehicle_readings(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_readings_has_a_value check (hours is not null or distance is not null),
  constraint vehicle_readings_entry_matches_source check ((source = 'entry') = (entry_id is not null))
);

create index if not exists vehicle_readings_book_date_idx
  on public.vehicle_readings(book_id, reading_date desc);

-- OWNERSHIP

create or replace function public.service_book_owned(p_book_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.service_books b
      join public.vehicles v on v.id = b.vehicle_id
     where b.id = p_book_id
       and v.user_id = auth.uid()
  );
$$;

create or replace function public.service_entry_owned(p_entry_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.service_entries e
     where e.id = p_entry_id
       and public.service_book_owned(e.book_id)
  );
$$;

revoke all on function public.service_book_owned(uuid) from public, anon, authenticated;
grant execute on function public.service_book_owned(uuid) to authenticated, service_role;
revoke all on function public.service_entry_owned(uuid) from public, anon, authenticated;
grant execute on function public.service_entry_owned(uuid) to authenticated, service_role;

-- THE PINS
--
-- On insert from a Data API role, the clock and the rider are the server's. On
-- every update, by anyone, what says who logged the entry, when, into which
-- book and from where cannot change, and the revision counter moves once per
-- transaction. security invoker on purpose: `current_user` is what tells a
-- rider's write from the owner-run transfer copy, and a definer function would
-- always read its owner.
create or replace function public.service_entries_pin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated', 'service_role') then
      new.logged_at := now();
      new.logged_by := coalesce(auth.uid(), new.logged_by);
      new.copied_from_entry_id := null;
      if new.deleted_at is not null then
        new.deleted_at := now();
      end if;
    end if;
    new.revision := 1;
    return new;
  end if;

  new.book_id := old.book_id;
  new.logged_at := old.logged_at;
  new.logged_by := old.logged_by;
  new.origin := old.origin;
  new.copied_from_entry_id := old.copied_from_entry_id;
  new.created_at := old.created_at;
  if new.deleted_at is distinct from old.deleted_at and new.deleted_at is not null then
    new.deleted_at := now();
  end if;

  if exists (
    select 1
      from public.service_entry_revisions r
     where r.entry_id = old.id
       and r.transaction_id = txid_current()
  ) then
    new.revision := old.revision;
  else
    new.revision := old.revision + 1;
  end if;

  return new;
end;
$$;

create or replace trigger service_entries_pin
  before insert or update on public.service_entries
  for each row execute function public.service_entries_pin();

create or replace trigger service_entries_set_updated_at
  before update on public.service_entries
  for each row execute function public.set_updated_at();

create or replace function public.vehicle_readings_pin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated', 'service_role') then
      new.read_at := now();
    end if;
    return new;
  end if;

  new.book_id := old.book_id;
  new.read_at := old.read_at;
  new.source := old.source;
  new.entry_id := old.entry_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

create or replace trigger vehicle_readings_pin
  before insert or update on public.vehicle_readings
  for each row execute function public.vehicle_readings_pin();

create or replace trigger vehicle_readings_set_updated_at
  before update on public.vehicle_readings
  for each row execute function public.set_updated_at();

create or replace trigger service_books_set_updated_at
  before update on public.service_books
  for each row execute function public.set_updated_at();

create or replace trigger service_book_fields_set_updated_at
  before update on public.service_book_fields
  for each row execute function public.set_updated_at();

create or replace trigger service_items_set_updated_at
  before update on public.service_items
  for each row execute function public.set_updated_at();

-- THE EDIT HISTORY
--
-- After every insert or update of an entry, its snapshot is written as the
-- entry's current revision: a new row for the first write of a transaction, the
-- same row refreshed for every later one, so the revision holds the state the
-- transaction committed. A transaction that created the entry stays `created`.
-- Its kind is the transaction's net change, read against the revision before it
-- rather than the row event: a delete followed by an item edit is `deleted`, and
-- a delete undone in the same transaction is `edited`.
--
-- security definer because it writes a table no API role may write. It cannot
-- be called directly - it returns `trigger` - but the execute decision is
-- written down here as for every security definer function.
create or replace function public.record_service_entry_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_was_deleted boolean;
  v_snapshot jsonb;
begin
  if tg_op = 'INSERT' then
    v_kind := 'created';
  else
    select r.snapshot ->> 'deleted_at' is not null
      into v_was_deleted
      from public.service_entry_revisions r
     where r.entry_id = new.id
       and r.transaction_id <> txid_current()
     order by r.revision desc
     limit 1;

    if not v_was_deleted and new.deleted_at is not null then
      v_kind := 'deleted';
    elsif v_was_deleted and new.deleted_at is null then
      v_kind := 'restored';
    else
      v_kind := 'edited';
    end if;
  end if;

  v_snapshot := (to_jsonb(new) - 'revision' - 'updated_at') || jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'item_id', i.item_id, 'label', i.label)
                       order by i.created_at, i.id)
        from public.service_entry_items i
       where i.entry_id = new.id
    ), '[]'::jsonb),
    'parts', coalesce((
      select jsonb_agg(jsonb_build_object(
                         'id', p.id, 'entry_item_id', p.entry_item_id, 'brand', p.brand,
                         'part_number', p.part_number, 'quantity', p.quantity,
                         'unit_cost_cents', p.unit_cost_cents)
                       order by p.created_at, p.id)
        from public.service_entry_parts p
       where p.entry_id = new.id
    ), '[]'::jsonb)
  );

  update public.service_entry_revisions r
     set snapshot = v_snapshot,
         kind = case when r.kind = 'created' then r.kind else v_kind end
   where r.entry_id = new.id
     and r.transaction_id = txid_current();

  if not found then
    insert into public.service_entry_revisions (entry_id, revision, kind, snapshot, changed_by, transaction_id)
    values (new.id, new.revision, v_kind, v_snapshot, auth.uid(), txid_current());
  end if;

  return null;
end;
$$;

revoke all on function public.record_service_entry_revision() from public, anon, authenticated;

create or replace trigger service_entries_record_revision
  after insert or update on public.service_entries
  for each row execute function public.record_service_entry_revision();

-- A change to an entry's items or parts is a change to the entry: touching the
-- entry row sends it through the pin and the history above, so there is one
-- path that writes a revision. security definer because the rider holds no
-- update on `updated_at`; the row it touches is one the rider's own write on the
-- child already had to own. When the entry itself is going (its vehicle's
-- cascade), the update finds no row and writes nothing.
create or replace function public.touch_service_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.service_entries set updated_at = now() where id = old.entry_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.entry_id is distinct from old.entry_id) then
    update public.service_entries set updated_at = now() where id = new.entry_id;
  end if;
  return null;
end;
$$;

revoke all on function public.touch_service_entry() from public, anon, authenticated;

create or replace trigger service_entry_items_touch_entry
  after insert or update or delete on public.service_entry_items
  for each row execute function public.touch_service_entry();

create or replace trigger service_entry_parts_touch_entry
  after insert or update or delete on public.service_entry_parts
  for each row execute function public.touch_service_entry();

-- An entry's reading is a reading. It follows the entry: written with it,
-- changed with it, and gone while the entry is removed or carries no reading,
-- so a soft-deleted entry stops counting as the truth about the bike's usage.
-- security definer because a rider may not write `source = 'entry'` rows.
create or replace function public.sync_service_entry_reading()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null or (new.reading_hours is null and new.reading_distance is null) then
    delete from public.vehicle_readings where entry_id = new.id;
    return null;
  end if;

  insert into public.vehicle_readings (book_id, reading_date, read_at, hours, distance, source, entry_id)
  values (new.book_id, new.service_date, new.logged_at, new.reading_hours, new.reading_distance, 'entry', new.id)
  on conflict (entry_id) do update
    set reading_date = excluded.reading_date,
        hours = excluded.hours,
        distance = excluded.distance;

  return null;
end;
$$;

revoke all on function public.sync_service_entry_reading() from public, anon, authenticated;

create or replace trigger service_entries_sync_reading
  after insert or update on public.service_entries
  for each row execute function public.sync_service_entry_reading();

-- ROW LEVEL SECURITY

alter table public.service_books enable row level security;
alter table public.service_book_fields enable row level security;
alter table public.service_items enable row level security;
alter table public.service_entries enable row level security;
alter table public.service_entry_items enable row level security;
alter table public.service_entry_parts enable row level security;
alter table public.service_entry_revisions enable row level security;
alter table public.vehicle_readings enable row level security;

-- The book's own policies read the vehicle directly: `service_book_owned`
-- reads this table, so using it here would recurse.
create policy "service_books: select own"
  on public.service_books for select
  using (exists (select 1 from public.vehicles v where v.id = service_books.vehicle_id and v.user_id = auth.uid()));

create policy "service_books: insert own"
  on public.service_books for insert
  with check (exists (select 1 from public.vehicles v where v.id = service_books.vehicle_id and v.user_id = auth.uid()));

create policy "service_books: update own"
  on public.service_books for update
  using (exists (select 1 from public.vehicles v where v.id = service_books.vehicle_id and v.user_id = auth.uid()))
  with check (exists (select 1 from public.vehicles v where v.id = service_books.vehicle_id and v.user_id = auth.uid()));

create policy "service_book_fields: select own"
  on public.service_book_fields for select
  using (public.service_book_owned(book_id));

create policy "service_book_fields: insert own"
  on public.service_book_fields for insert
  with check (public.service_book_owned(book_id));

create policy "service_book_fields: update own"
  on public.service_book_fields for update
  using (public.service_book_owned(book_id))
  with check (public.service_book_owned(book_id));

create policy "service_items: select own"
  on public.service_items for select
  using (public.service_book_owned(book_id));

create policy "service_items: insert own"
  on public.service_items for insert
  with check (public.service_book_owned(book_id));

create policy "service_items: update own"
  on public.service_items for update
  using (public.service_book_owned(book_id))
  with check (public.service_book_owned(book_id));

create policy "service_entries: select own"
  on public.service_entries for select
  using (public.service_book_owned(book_id));

create policy "service_entries: insert own"
  on public.service_entries for insert
  with check (public.service_book_owned(book_id));

create policy "service_entries: update own"
  on public.service_entries for update
  using (public.service_book_owned(book_id))
  with check (public.service_book_owned(book_id));

-- An entry's item must be one of the same book's items, or an entry could
-- reset another bike's interval.
create policy "service_entry_items: select own"
  on public.service_entry_items for select
  using (public.service_entry_owned(entry_id));

create policy "service_entry_items: insert own"
  on public.service_entry_items for insert
  with check (
    public.service_entry_owned(entry_id)
    and (service_entry_items.item_id is null or exists (
      select 1
        from public.service_items i
        join public.service_entries e on e.book_id = i.book_id
       where i.id = service_entry_items.item_id
         and e.id = service_entry_items.entry_id
    ))
  );

create policy "service_entry_items: update own"
  on public.service_entry_items for update
  using (public.service_entry_owned(entry_id))
  with check (
    public.service_entry_owned(entry_id)
    and (service_entry_items.item_id is null or exists (
      select 1
        from public.service_items i
        join public.service_entries e on e.book_id = i.book_id
       where i.id = service_entry_items.item_id
         and e.id = service_entry_items.entry_id
    ))
  );

create policy "service_entry_items: delete own"
  on public.service_entry_items for delete
  using (public.service_entry_owned(entry_id));

create policy "service_entry_parts: select own"
  on public.service_entry_parts for select
  using (public.service_entry_owned(entry_id));

create policy "service_entry_parts: insert own"
  on public.service_entry_parts for insert
  with check (
    public.service_entry_owned(entry_id)
    and (service_entry_parts.entry_item_id is null or exists (
      select 1
        from public.service_entry_items i
       where i.id = service_entry_parts.entry_item_id
         and i.entry_id = service_entry_parts.entry_id
    ))
  );

create policy "service_entry_parts: update own"
  on public.service_entry_parts for update
  using (public.service_entry_owned(entry_id))
  with check (
    public.service_entry_owned(entry_id)
    and (service_entry_parts.entry_item_id is null or exists (
      select 1
        from public.service_entry_items i
       where i.id = service_entry_parts.entry_item_id
         and i.entry_id = service_entry_parts.entry_id
    ))
  );

create policy "service_entry_parts: delete own"
  on public.service_entry_parts for delete
  using (public.service_entry_owned(entry_id));

create policy "service_entry_revisions: select own"
  on public.service_entry_revisions for select
  using (public.service_entry_owned(entry_id));

create policy "vehicle_readings: select own"
  on public.vehicle_readings for select
  using (public.service_book_owned(book_id));

-- A correction supersedes one of the same book's rider readings. A reading an
-- entry wrote is corrected by editing the entry.
create policy "vehicle_readings: insert own"
  on public.vehicle_readings for insert
  with check (
    public.service_book_owned(book_id)
    and (vehicle_readings.supersedes_id is null or exists (
      select 1
        from public.vehicle_readings r
       where r.id = vehicle_readings.supersedes_id
         and r.book_id = vehicle_readings.book_id
         and r.source = 'rider'
    ))
  );

-- GRANTS
--
-- No delete on entries or readings for any API role, and no update on a
-- reading: a rider corrects one by superseding it. Items and parts of an
-- entry may be removed while editing it, because the revision written by that
-- edit keeps what they were. No grant reaches the provenance columns: a book's
-- transfer origin, an entry's `logged_at`, `logged_by`, `revision` and copy
-- origin, a reading's `read_at`, `source` and `entry_id`.
revoke all on public.service_books from public, anon, authenticated;
grant select on public.service_books to authenticated;
grant insert (id, vehicle_id, tracks_hours, tracks_distance, distance_unit, default_session_minutes, default_session_distance)
  on public.service_books to authenticated;
grant update (tracks_hours, tracks_distance, distance_unit, default_session_minutes, default_session_distance)
  on public.service_books to authenticated;

revoke all on public.service_book_fields from public, anon, authenticated;
grant select on public.service_book_fields to authenticated;
grant insert (id, book_id, builtin_key, label, field_type, options, enabled, required, sort_order)
  on public.service_book_fields to authenticated;
grant update (label, options, enabled, required, sort_order)
  on public.service_book_fields to authenticated;

revoke all on public.service_items from public, anon, authenticated;
grant select on public.service_items to authenticated;
grant insert (id, book_id, name, interval_hours, interval_distance, interval_days, source, sort_order, archived_at)
  on public.service_items to authenticated;
grant update (name, interval_hours, interval_distance, interval_days, sort_order, archived_at)
  on public.service_items to authenticated;

revoke all on public.service_entries from public, anon, authenticated;
grant select on public.service_entries to authenticated;
grant insert (id, book_id, service_date, reading_hours, reading_distance, performed_by, shop_name, cost_cents, currency, notes, custom_fields, origin)
  on public.service_entries to authenticated;
grant update (service_date, reading_hours, reading_distance, performed_by, shop_name, cost_cents, currency, notes, custom_fields, deleted_at)
  on public.service_entries to authenticated;

revoke all on public.service_entry_items from public, anon, authenticated;
grant select, delete on public.service_entry_items to authenticated;
grant insert (id, entry_id, item_id, label) on public.service_entry_items to authenticated;
grant update (item_id, label) on public.service_entry_items to authenticated;

revoke all on public.service_entry_parts from public, anon, authenticated;
grant select, delete on public.service_entry_parts to authenticated;
grant insert (id, entry_id, entry_item_id, brand, part_number, quantity, unit_cost_cents)
  on public.service_entry_parts to authenticated;
grant update (entry_item_id, brand, part_number, quantity, unit_cost_cents)
  on public.service_entry_parts to authenticated;

revoke all on public.vehicle_readings from public, anon, authenticated;
grant select on public.vehicle_readings to authenticated;
grant insert (id, book_id, reading_date, hours, distance, supersedes_id) on public.vehicle_readings to authenticated;

-- The history, the entries it describes and the readings are closed to the
-- service role too, which otherwise holds everything through the default
-- privileges (20260719001100). The triggers write the history and an entry's
-- reading as the owner, and a vehicle's cascade deletes as the owner, so none
-- of them needs these.
revoke all on public.service_entry_revisions from public, anon, authenticated, service_role;
grant select on public.service_entry_revisions to authenticated, service_role;
revoke delete, truncate on public.service_entries from service_role;
revoke update, delete, truncate on public.vehicle_readings from service_role;
