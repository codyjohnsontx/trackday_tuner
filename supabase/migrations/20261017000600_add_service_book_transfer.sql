-- Handing a bike to a buyer: the handover row, the copy, and the Sold state.
--
-- The owner's rule (decision PQ2, 2026-10-08, their words): "The seller keeps a
-- copy of the sessions and notes and the buyer gets the sessions and notes but
-- once its handed over. New data that gets added to the bike is severed from the
-- previous owner. The previous owner gets to keep the records he made up until
-- the bike changed hands." And their answers of 2026-10-17 (TQ1 to TQ6):
--
-- - TQ1: copied history does not count toward the buyer's free session and
--   attachment caps; only what the buyer adds counts.
-- - TQ2: the previous owner's entries are locked for the buyer - remove only,
--   labelled.
-- - TQ3: the seller's copy becomes read-only, marked Sold, and the sold bike
--   leaves the seller's free vehicle count.
-- - TQ4: a handover link lasts 14 days, one pending per bike, cancel to
--   reissue.
-- - TQ5: the seller's saved baseline setup is not copied (the sessions it came
--   from are).
-- - TQ6: receipts are copied as uploaded.
--
-- A HANDOVER IS A COPY, MADE AT ACCEPT. The buyer gets a NEW vehicle row, a NEW
-- service book on it, and a copy of every row that describes the bike as it
-- stands the moment they accept: the book's settings and field layout, its
-- items, every live entry with its items, parts, full edit history and
-- receipts, the rider readings, the session weights and due overrides, and
-- every session on the bike with its laps, environment, telemetry summary,
-- outcome and setup changes. The seller's rows are not touched except for
-- `vehicles.sold_at`. Not copied, because they are about the rider rather than
-- the bike: the Race Engineer's advice and memory, the saved baseline (TQ5),
-- AI question text and audit rows, product events and session tombstones. A
-- removed entry comes over only as `transferred_removed_entry_count`, never its
-- content (PQ6), and that count is the whole history's: the seller's removals
-- plus the ones their own book came with. After accept the two copies are two riders' private rows under
-- the RLS that already exists, and no policy here reaches across.
--
-- THE STEPS. `create_service_book_transfer` (the seller) stores the buyer's
-- email and the SHA-256 of a link token the server made, as share links do
-- (20261016000500). `prepare_service_book_transfer_accept` (the buyer) mints
-- the new vehicle and book ids and the ids of every session and ready
-- attachment, and returns which storage objects to copy where; the server
-- copies them through the Storage API, because SQL cannot write an object.
-- `accept_service_book_transfer` (the buyer) is the copy itself, one
-- transaction, and refuses with TT409 unless every object prepare named is
-- really in storage and every session and receipt of the bike is in the maps -
-- a session synced between the two calls is caught here, and pressing Accept
-- again re-prepares. Both are idempotent: a second accept returns the first
-- one's result and writes nothing. `cancel_service_book_transfer` (the seller)
-- and `describe_service_book_transfer` (the link page, service role) complete
-- the set. Prepare and accept take the raw token and hash it here, so the
-- stored hash - which no rider can read - is not itself a key.
--
-- HONEST HISTORY ON THE COPY. A copied entry keeps `logged_at`, `logged_by`,
-- `origin`, `created_at` and every revision the seller's history holds, with
-- its snapshot, date, author and transaction; the copy is the next revision, of
-- kind `transferred`, which the labels already do not count as an edit. That
-- needs two changes to 20261010000100's triggers, made here by `create or
-- replace`: the pin keeps a supplied `revision` on an owner-run insert of a
-- copied entry, and the history writes `transferred` for one. The buyer's book
-- carries the seller's `owner_time_zone`, so every copied label reads in the
-- zone it was logged in; the pin of 20261016000500 then keeps it.
--
-- WHAT ONLY A FUNCTION CAN WRITE. `vehicles.sold_at`,
-- `sessions.copied_from_session_id` and `sessions.original_user_id` sit on
-- tables `authenticated` holds table-level insert and update on
-- (20260719001100), so a trigger pins each: null on a Data API insert, kept on
-- every update. Without the session pins a rider could mark their own sessions
-- copied and escape the free cap.
-- `service_attachments.copied_from_attachment_id` and
-- `service_books.transferred_removed_entry_count` are in no rider grant and the
-- attachments table takes no API insert at all.
--
-- THE SELLER'S COPY IS READ-ONLY (TQ3), in SQL rather than only on screen.
-- `service_book_writable` is `service_book_owned` and the vehicle not sold, and
-- every insert, update and delete policy of the service book's tables now reads
-- it, while the select policies keep `service_book_owned`. The five write
-- functions refuse a sold book or bike with TT410 first, so the refusal has a
-- code a screen and the phone can name. A session cannot be logged on, or moved
-- onto, a sold bike: a trigger refuses it with TT410 on every path, which leaves
-- the session policies of 20260928002300 as they are. Share links keep working:
-- they show the seller their read-only copy.
--
-- THE PREVIOUS OWNER'S ENTRIES ARE LOCKED FOR THE BUYER (TQ2). A copied entry
-- may be removed (or restored) and nothing else: the pin refuses, from a Data
-- API role, any other change to an entry carrying `copied_from_entry_id` with
-- TT403, and its items and parts take no write through `service_entry_writable`.
-- `save_service_entry` refuses one with TT403 before either, and
-- `reserve_service_attachment` adds no attachment to one.
--
-- CAPS COUNT WHAT A RIDER LOGGED (TQ1, TQ7). `create_session_with_laps` counts
-- the rider's sessions with no `copied_from_session_id`, and
-- `reserve_service_attachment` the book's attachments with no
-- `copied_from_attachment_id` - and each also counts a copy the rider logged
-- themselves, come back to them on a bike handed back (TQ7), so two accounts
-- passing one bike between them gain nothing. A copied session carries the
-- rider who logged the first of its line in `original_user_id`, which accept
-- writes, because the earlier owner's rows are not the buyer's to read; a
-- copied attachment carries its uploader in `created_by` already. The vehicle cap counts vehicles not sold, which
-- prepare and accept apply to the buyer: a free buyer already holding an
-- unsold bike is TT402, the only cap that can refuse a handover.
--
-- Every new function decides its execute here, revoking from public, anon,
-- authenticated and service_role by name, because the hosted project hands
-- execute on every new public function to service_role.

-- COLUMNS

alter table public.vehicles add column if not exists sold_at timestamptz;

alter table public.service_books
  add column if not exists transferred_removed_entry_count integer not null default 0
    check (transferred_removed_entry_count >= 0);

alter table public.sessions add column if not exists copied_from_session_id uuid;

alter table public.sessions add column if not exists original_user_id uuid;

alter table public.service_attachments add column if not exists copied_from_attachment_id uuid;

-- THE HANDOVER

create table if not exists public.service_book_transfers (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.service_books(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_email_normalized text not null
    check (to_email_normalized = lower(btrim(to_email_normalized)) and to_email_normalized like '%_@_%'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  expires_at timestamptz not null default now() + interval '14 days',
  handover_hours numeric check (handover_hours >= 0),
  handover_distance numeric check (handover_distance >= 0),
  seller_time_zone text check (seller_time_zone is null or seller_time_zone ~ '^[A-Za-z0-9_+/-]{1,64}$'),
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  new_vehicle_id uuid,
  new_book_id uuid,
  session_id_map jsonb not null default '{}'::jsonb check (jsonb_typeof(session_id_map) = 'object'),
  attachment_id_map jsonb not null default '{}'::jsonb check (jsonb_typeof(attachment_id_map) = 'object'),
  to_user_id uuid references auth.users(id) on delete set null,
  result jsonb,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint service_book_transfers_accepted_is_dated check ((status = 'accepted') = (accepted_at is not null)),
  constraint service_book_transfers_cancelled_is_dated check ((status = 'cancelled') = (cancelled_at is not null))
);

-- One pending handover per book (TQ4): a new link needs the old one cancelled,
-- expired or not.
create unique index if not exists service_book_transfers_one_pending
  on public.service_book_transfers(book_id)
  where status = 'pending';

alter table public.service_book_transfers enable row level security;

create policy "service_book_transfers: select own"
  on public.service_book_transfers for select
  using (public.service_book_owned(book_id));

-- The seller reads their own handovers, less the token's hash; nobody writes
-- the table but the functions below, the service role included.
revoke all on public.service_book_transfers from public, anon, authenticated, service_role;
grant select (id, book_id, to_email_normalized, status, expires_at, handover_hours, handover_distance, summary, accepted_at, cancelled_at, created_at)
  on public.service_book_transfers to authenticated;
grant select on public.service_book_transfers to service_role;

-- WHO MAY WRITE A BOOK
--
-- security invoker, like service_book_owned: RLS on vehicles still applies
-- inside them. The bike's row is read `for key share`, so a write that meets a
-- running accept waits for it and then reads the bike sold, rather than
-- passing on the snapshot from before the sale and landing in the seller's
-- read-only copy.

create or replace function public.service_book_writable(p_book_id uuid)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_sold_at timestamptz;
begin
  select v.sold_at into v_sold_at
    from public.service_books b
    join public.vehicles v on v.id = b.vehicle_id
   where b.id = p_book_id
     and v.user_id = auth.uid()
   for key share of v;
  return found and v_sold_at is null;
end;
$$;

-- An entry's items and parts change only on an entry this book's rider logged:
-- a copied entry's are the previous owner's (TQ2).
create or replace function public.service_entry_writable(p_entry_id uuid)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.service_entries e
     where e.id = p_entry_id
       and e.copied_from_entry_id is null
       and public.service_book_writable(e.book_id)
  );
$$;

revoke all on function public.service_book_writable(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_book_writable(uuid) to authenticated, service_role;
revoke all on function public.service_entry_writable(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_entry_writable(uuid) to authenticated, service_role;

alter policy "service_books: insert own"
  on public.service_books
  with check (exists (select 1 from public.vehicles v where v.id = service_books.vehicle_id and v.user_id = auth.uid() and v.sold_at is null));

alter policy "service_books: update own"
  on public.service_books
  using (public.service_book_writable(id))
  with check (exists (select 1 from public.vehicles v where v.id = service_books.vehicle_id and v.user_id = auth.uid() and v.sold_at is null));

alter policy "service_book_fields: insert own"
  on public.service_book_fields
  with check (public.service_book_writable(book_id));

alter policy "service_book_fields: update own"
  on public.service_book_fields
  using (public.service_book_writable(book_id))
  with check (public.service_book_writable(book_id));

alter policy "service_items: insert own"
  on public.service_items
  with check (public.service_book_writable(book_id));

alter policy "service_items: update own"
  on public.service_items
  using (public.service_book_writable(book_id))
  with check (public.service_book_writable(book_id));

alter policy "service_entries: insert own"
  on public.service_entries
  with check (public.service_book_writable(book_id));

alter policy "service_entries: update own"
  on public.service_entries
  using (public.service_book_writable(book_id))
  with check (public.service_book_writable(book_id));

alter policy "service_entry_items: insert own"
  on public.service_entry_items
  with check (
    public.service_entry_writable(entry_id)
    and (service_entry_items.item_id is null or exists (
      select 1
        from public.service_items i
        join public.service_entries e on e.book_id = i.book_id
       where i.id = service_entry_items.item_id
         and e.id = service_entry_items.entry_id
    ))
  );

alter policy "service_entry_items: update own"
  on public.service_entry_items
  using (public.service_entry_writable(entry_id))
  with check (
    public.service_entry_writable(entry_id)
    and (service_entry_items.item_id is null or exists (
      select 1
        from public.service_items i
        join public.service_entries e on e.book_id = i.book_id
       where i.id = service_entry_items.item_id
         and e.id = service_entry_items.entry_id
    ))
  );

alter policy "service_entry_items: delete own"
  on public.service_entry_items
  using (public.service_entry_writable(entry_id));

alter policy "service_entry_parts: insert own"
  on public.service_entry_parts
  with check (
    public.service_entry_writable(entry_id)
    and (service_entry_parts.entry_item_id is null or exists (
      select 1
        from public.service_entry_items i
       where i.id = service_entry_parts.entry_item_id
         and i.entry_id = service_entry_parts.entry_id
    ))
  );

alter policy "service_entry_parts: update own"
  on public.service_entry_parts
  using (public.service_entry_writable(entry_id))
  with check (
    public.service_entry_writable(entry_id)
    and (service_entry_parts.entry_item_id is null or exists (
      select 1
        from public.service_entry_items i
       where i.id = service_entry_parts.entry_item_id
         and i.entry_id = service_entry_parts.entry_id
    ))
  );

alter policy "service_entry_parts: delete own"
  on public.service_entry_parts
  using (public.service_entry_writable(entry_id));

alter policy "vehicle_readings: insert own"
  on public.vehicle_readings
  with check (
    public.service_book_writable(book_id)
    and (vehicle_readings.supersedes_id is null or exists (
      select 1
        from public.vehicle_readings r
       where r.id = vehicle_readings.supersedes_id
         and r.book_id = vehicle_readings.book_id
         and r.source = 'rider'
    ))
  );

alter policy "session_usage_weights: insert own"
  on public.session_usage_weights
  with check (
    public.service_book_writable(book_id)
    and exists (
      select 1
        from public.sessions s
        join public.service_books b on b.vehicle_id = s.vehicle_id
       where s.id = session_usage_weights.session_id
         and b.id = session_usage_weights.book_id
         and s.user_id = auth.uid()
    )
  );

alter policy "session_usage_weights: update own"
  on public.session_usage_weights
  using (public.service_book_writable(book_id));

alter policy "session_usage_weights: delete own"
  on public.session_usage_weights
  using (public.service_book_writable(book_id));

alter policy "service_due_overrides: insert own"
  on public.service_due_overrides
  with check (
    public.service_book_writable(book_id)
    and exists (
      select 1
        from public.service_items i
       where i.id = service_due_overrides.item_id
         and i.book_id = service_due_overrides.book_id
    )
  );

alter policy "service_due_overrides: update own"
  on public.service_due_overrides
  using (public.service_book_writable(book_id));

-- THE PINS

-- 20261010000100's pin, with two changes: an owner-run insert of a copied entry
-- keeps the revision it is given (the seller's last plus one, so the seller's
-- history fits under it), and a Data API role may change a copied entry's
-- `deleted_at` and nothing else (TQ2). Every other line is unchanged.
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
    if new.copied_from_entry_id is null then
      new.revision := 1;
    end if;
    return new;
  end if;

  new.book_id := old.book_id;
  new.logged_at := old.logged_at;
  new.logged_by := old.logged_by;
  new.origin := old.origin;
  new.copied_from_entry_id := old.copied_from_entry_id;
  new.created_at := old.created_at;
  if old.deleted_at is not null and new.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  elsif old.deleted_at is null and new.deleted_at is not null then
    new.deleted_at := now();
  end if;

  if current_user in ('anon', 'authenticated', 'service_role')
     and old.copied_from_entry_id is not null
     and (to_jsonb(new) - 'deleted_at' - 'updated_at' - 'revision')
         is distinct from (to_jsonb(old) - 'deleted_at' - 'updated_at' - 'revision') then
    raise exception 'an entry the previous owner logged can be removed but not edited' using errcode = 'TT403';
  end if;

  if exists (
    select 1
      from public.service_entry_revisions r
     where r.entry_id = old.id
       and r.transaction_id = txid_current()
  ) or public.service_entry_snapshot(to_jsonb(new)) = (
    select r.snapshot
      from public.service_entry_revisions r
     where r.entry_id = old.id
     order by r.revision desc
     limit 1
  ) then
    new.revision := old.revision;
  else
    new.revision := old.revision + 1;
  end if;

  return new;
end;
$$;

-- 20261010000100's history, with one change: the revision an insert writes is
-- `transferred` for a copied entry and `created` otherwise, and a later write
-- in the same transaction keeps either. Every other line is unchanged.
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
    v_kind := case when new.copied_from_entry_id is null then 'created' else 'transferred' end;
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

  v_snapshot := public.service_entry_snapshot(to_jsonb(new));

  update public.service_entry_revisions r
     set snapshot = v_snapshot,
         kind = case when r.kind in ('created', 'transferred') then r.kind else v_kind end
   where r.entry_id = new.id
     and r.transaction_id = txid_current();

  if not found and (tg_op = 'INSERT' or new.revision <> old.revision) then
    insert into public.service_entry_revisions (entry_id, revision, kind, snapshot, changed_by, transaction_id)
    values (new.id, new.revision, v_kind, v_snapshot, auth.uid(), txid_current());
  end if;

  return null;
end;
$$;

revoke all on function public.record_service_entry_revision() from public, anon, authenticated, service_role;

-- A rider cannot mark a sale. On a Data API insert `sold_at` is null; on every
-- Data API update it is what it was. Only accept, running as the owner, sets it.
create or replace function public.vehicles_pin_sold_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated', 'service_role') then
    if tg_op = 'INSERT' then
      new.sold_at := null;
    else
      new.sold_at := old.sold_at;
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger vehicles_pin_sold_at
  before insert or update on public.vehicles
  for each row execute function public.vehicles_pin_sold_at();

revoke all on function public.vehicles_pin_sold_at() from public, anon, authenticated, service_role;

-- A rider cannot mark their own session copied, or name who logged it, either of
-- which would take it out of the free cap: null on a Data API insert, and kept
-- on every update by anyone.
create or replace function public.sessions_pin_transfer_origin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated', 'service_role') then
      new.copied_from_session_id := null;
      new.original_user_id := null;
    end if;
  else
    new.copied_from_session_id := old.copied_from_session_id;
    new.original_user_id := old.original_user_id;
  end if;
  return new;
end;
$$;

create or replace trigger sessions_pin_transfer_origin
  before insert or update on public.sessions
  for each row execute function public.sessions_pin_transfer_origin();

revoke all on function public.sessions_pin_transfer_origin() from public, anon, authenticated, service_role;

-- No session is logged on, or moved onto, a bike that was handed over (TQ3),
-- whoever writes it: the website form, the phone and a direct insert alike.
-- TT410 is what create_session_with_laps answers too. A session already on the
-- bike stays readable and editable; the delete of a sold bike cascades as ever.
-- The bike is read `for key share`, as service_book_writable reads it, so a
-- session synced while accept runs waits and is refused rather than landing
-- on the seller's copy after the buyer's was made.
create or replace function public.sessions_refuse_sold_vehicle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sold_at timestamptz;
begin
  if tg_op = 'INSERT' or new.vehicle_id is distinct from old.vehicle_id then
    select v.sold_at into v_sold_at
      from public.vehicles v
     where v.id = new.vehicle_id
       for key share;
    if v_sold_at is not null then
      raise exception 'this bike was handed over to a new owner, so no session can be logged on it'
        using errcode = 'TT410';
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger sessions_refuse_sold_vehicle
  before insert or update on public.sessions
  for each row execute function public.sessions_refuse_sold_vehicle();

revoke all on function public.sessions_refuse_sold_vehicle() from public, anon, authenticated, service_role;

-- THE CAPS AND THE SOLD STATE IN THE WRITE FUNCTIONS

-- 20260928002300's function, with two changes: a sold bike is refused with
-- TT410, and the free cap counts only sessions the rider logged (TQ1, TQ7). The
-- signature is unchanged, so the phone and the schema contract call it as
-- before.
create or replace function public.create_session_with_laps(
  p_session_id uuid,
  p_session jsonb,
  p_laps jsonb,
  p_environment jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_unlimited boolean;
begin
  if auth.uid() is null then
    raise exception 'create_session_with_laps needs a signed-in rider' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('create_session_with_laps:' || auth.uid()::text, 0));

  select s.* into v_session
    from public.sessions s
   where s.id = p_session_id
     and s.user_id = auth.uid();

  if found then
    return jsonb_build_object('replayed', true, 'session', to_jsonb(v_session));
  end if;

  if exists (
    select 1
      from public.deleted_sessions d
     where d.user_id = auth.uid()
       and d.session_id = p_session_id
  ) then
    return jsonb_build_object('replayed', true, 'deleted', true, 'session', null);
  end if;

  if exists (
    select 1
      from public.vehicles v
     where v.id = (p_session ->> 'vehicle_id')::uuid
       and v.user_id = auth.uid()
       and v.sold_at is not null
  ) then
    raise exception 'this bike was handed over to a new owner, so no session can be logged on it'
      using errcode = 'TT410';
  end if;

  select p.tier = 'pro'
         or (p.beta_access_expires_at > now()
             and (p.beta_access_started_at is null or p.beta_access_started_at <= now()))
    into v_unlimited
    from public.profiles p
   where p.id = auth.uid();

  if not coalesce(v_unlimited, false)
     and (
       select count(*)
         from public.sessions s
        where s.user_id = auth.uid()
          and (s.copied_from_session_id is null or s.original_user_id = auth.uid())
     ) >= 10 then
    raise exception 'the free plan holds 10 sessions' using errcode = 'TT402';
  end if;

  if not exists (
    select 1
      from public.vehicles v
     where v.id = (p_session ->> 'vehicle_id')::uuid
       and v.user_id = auth.uid()
  ) then
    raise exception 'the vehicle this session names is not one of this rider''s'
      using errcode = 'TT404';
  end if;

  begin
    insert into public.sessions (
      id, user_id, vehicle_id, track_id, track_name, layout_id, layout_name,
      date, start_time, session_number, conditions, tires, suspension,
      alignment, enabled_modules, extra_modules, notes
    )
    select
      p_session_id, auth.uid(), r.vehicle_id, r.track_id, r.track_name, r.layout_id, r.layout_name,
      r.date, r.start_time, r.session_number, r.conditions, r.tires, r.suspension,
      r.alignment, coalesce(r.enabled_modules, '{}'::jsonb), r.extra_modules, r.notes
    from jsonb_populate_record(null::public.sessions, p_session) r
    returning * into v_session;
  exception when unique_violation then
    select s.* into v_session
      from public.sessions s
     where s.id = p_session_id
       and s.user_id = auth.uid();

    if found then
      return jsonb_build_object('replayed', true, 'session', to_jsonb(v_session));
    end if;

    raise;
  end;

  perform public.replace_session_laps(auth.uid(), p_session_id, p_laps, '[]'::jsonb);

  if p_environment is not null then
    insert into public.session_environment (
      user_id, session_id, ambient_temperature_c, track_temperature_c,
      humidity_percent, weather_condition, surface_condition, source
    )
    select
      auth.uid(), p_session_id, r.ambient_temperature_c, r.track_temperature_c,
      r.humidity_percent, r.weather_condition, r.surface_condition, coalesce(r.source, 'manual')
    from jsonb_populate_record(null::public.session_environment, p_environment) r;
  end if;

  return jsonb_build_object('replayed', false, 'session', to_jsonb(v_session));
end;
$$;

revoke all on function public.create_session_with_laps(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.create_session_with_laps(uuid, jsonb, jsonb, jsonb) to authenticated;

-- 20261013000300's save, with two refusals ahead of the write so each has a
-- code: a sold book is TT410 and a copied entry TT403. RLS and the pin refuse
-- both anyway; these only name the refusal.
create or replace function public.save_service_entry(
  p_book_id uuid,
  p_entry_id uuid,
  p_entry jsonb,
  p_items jsonb,
  p_parts jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_items jsonb;
  v_parts jsonb;
begin
  if auth.uid() is null then
    raise exception 'save_service_entry needs a signed-in rider' using errcode = '42501';
  end if;

  if not public.service_book_owned(p_book_id) then
    raise exception 'this service book is not one of this rider''s' using errcode = 'TT404';
  end if;

  if not public.service_book_writable(p_book_id) then
    raise exception 'this bike was handed over to a new owner, so its book no longer changes' using errcode = 'TT410';
  end if;

  if p_entry_id is not null and exists (
    select 1
      from public.service_entries e
     where e.id = p_entry_id
       and e.book_id = p_book_id
       and e.copied_from_entry_id is not null
  ) then
    raise exception 'an entry the previous owner logged can be removed but not edited' using errcode = 'TT403';
  end if;

  if jsonb_typeof(p_entry) is distinct from 'object' then
    raise exception 'p_entry must be an object' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'an entry has to name at least one item that was done' using errcode = '22023';
  end if;
  if p_parts is not null and jsonb_typeof(p_parts) is distinct from 'array' then
    raise exception 'p_parts must be an array or null' using errcode = '22023';
  end if;

  if p_entry_id is null then
    insert into public.service_entries (
      book_id, service_date, reading_hours, reading_distance, performed_by,
      shop_name, cost_cents, currency, notes, custom_fields
    )
    values (
      p_book_id,
      (p_entry ->> 'service_date')::date,
      (p_entry ->> 'reading_hours')::numeric,
      (p_entry ->> 'reading_distance')::numeric,
      p_entry ->> 'performed_by',
      p_entry ->> 'shop_name',
      (p_entry ->> 'cost_cents')::integer,
      coalesce(p_entry ->> 'currency', 'USD'),
      p_entry ->> 'notes',
      coalesce(p_entry -> 'custom_fields', '{}'::jsonb)
    )
    returning id into v_id;
  else
    update public.service_entries e
       set service_date = (p_entry ->> 'service_date')::date,
           reading_hours = (p_entry ->> 'reading_hours')::numeric,
           reading_distance = (p_entry ->> 'reading_distance')::numeric,
           performed_by = p_entry ->> 'performed_by',
           shop_name = p_entry ->> 'shop_name',
           cost_cents = (p_entry ->> 'cost_cents')::integer,
           currency = coalesce(p_entry ->> 'currency', e.currency),
           notes = p_entry ->> 'notes',
           custom_fields = coalesce(p_entry -> 'custom_fields', '{}'::jsonb)
     where e.id = p_entry_id
       and e.book_id = p_book_id
       and e.deleted_at is null
    returning e.id into v_id;

    if v_id is null then
      raise exception 'entry not found in this service book' using errcode = 'TT404';
    end if;
  end if;

  -- The items the save wants: a book item by its current name, which only an
  -- item new to the entry is stored with, and a typed item by its label.
  select coalesce(jsonb_agg(distinct jsonb_build_object('item_id', x.item_id, 'label', x.label)), '[]'::jsonb)
    into v_items
    from (
      select (e ->> 'item_id')::uuid as item_id,
             case
               when e ->> 'item_id' is null then nullif(btrim(e ->> 'label'), '')
               else (select i.name from public.service_items i where i.id = (e ->> 'item_id')::uuid and i.book_id = p_book_id)
             end as label
        from jsonb_array_elements(p_items) e
    ) x;

  if exists (select 1 from jsonb_array_elements(v_items) w where w ->> 'label' is null) then
    raise exception 'an item has to be one of this book''s items or a typed label' using errcode = 'TT404';
  end if;

  delete from public.service_entry_items i
   where i.entry_id = v_id
     and not exists (
       select 1 from jsonb_array_elements(v_items) w
        where (w ->> 'item_id')::uuid is not distinct from i.item_id
          and (i.item_id is not null or w ->> 'label' = i.label)
     );

  insert into public.service_entry_items (entry_id, item_id, label)
  select v_id, (w ->> 'item_id')::uuid, w ->> 'label'
    from jsonb_array_elements(v_items) w
   where not exists (
     select 1 from public.service_entry_items i
      where i.entry_id = v_id
        and i.item_id is not distinct from (w ->> 'item_id')::uuid
        and (i.item_id is not null or i.label = w ->> 'label')
   );

  select coalesce(jsonb_agg(jsonb_build_object(
           'brand', x.brand, 'part_number', x.part_number, 'quantity', x.quantity,
           'unit_cost_cents', x.unit_cost_cents, 'n', x.n
         )), '[]'::jsonb)
    into v_parts
    from (
      select y.*,
             row_number() over (partition by y.brand, y.part_number, y.quantity, y.unit_cost_cents) as n
        from (
          select nullif(btrim(e ->> 'brand'), '') as brand,
                 nullif(btrim(e ->> 'part_number'), '') as part_number,
                 (e ->> 'quantity')::numeric as quantity,
                 (e ->> 'unit_cost_cents')::integer as unit_cost_cents
            from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) e
        ) y
    ) x;

  delete from public.service_entry_parts p
   using (
     select s.id,
            row_number() over (partition by s.brand, s.part_number, s.quantity, s.unit_cost_cents order by s.id) as n
       from public.service_entry_parts s
      where s.entry_id = v_id
   ) s
   where p.id = s.id
     and not exists (
       select 1 from jsonb_array_elements(v_parts) w
        where (w ->> 'brand') is not distinct from p.brand
          and (w ->> 'part_number') is not distinct from p.part_number
          and (w ->> 'quantity')::numeric is not distinct from p.quantity
          and (w ->> 'unit_cost_cents')::integer is not distinct from p.unit_cost_cents
          and (w ->> 'n')::bigint = s.n
     );

  insert into public.service_entry_parts (entry_id, brand, part_number, quantity, unit_cost_cents)
  select v_id, w ->> 'brand', w ->> 'part_number', (w ->> 'quantity')::numeric, (w ->> 'unit_cost_cents')::integer
    from jsonb_array_elements(v_parts) w
   where (w ->> 'n')::bigint > (
     select count(*) from public.service_entry_parts p
      where p.entry_id = v_id
        and p.brand is not distinct from (w ->> 'brand')
        and p.part_number is not distinct from (w ->> 'part_number')
        and p.quantity is not distinct from (w ->> 'quantity')::numeric
        and p.unit_cost_cents is not distinct from (w ->> 'unit_cost_cents')::integer
   );

  return v_id;
end;
$$;

revoke all on function public.save_service_entry(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_service_entry(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

-- Where an attachment's file and thumbnail live: `<book id>/<attachment id>.jpg`
-- beside `.thumb.jpg`, or `.pdf` with no thumbnail. The one rule, read by the
-- reserve below and by the handover's copy, so a copied receipt sits where a
-- reserved one would. security invoker; no API role calls it.
create or replace function public.service_attachment_object_path(
  p_book_id uuid,
  p_attachment_id uuid,
  p_mime text,
  p_thumb boolean
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
           when p_mime = 'image/jpeg' and p_thumb then p_book_id::text || '/' || p_attachment_id::text || '.thumb.jpg'
           when p_mime = 'image/jpeg' then p_book_id::text || '/' || p_attachment_id::text || '.jpg'
           when p_thumb then null
           else p_book_id::text || '/' || p_attachment_id::text || '.pdf'
         end;
$$;

revoke all on function public.service_attachment_object_path(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;

-- 20261014000400's reserve, with three changes: a sold book is refused with
-- TT410, a copied entry takes no new attachment (TQ2, TT403), and the free
-- allowance counts only attachments the rider added (TQ1).
create or replace function public.reserve_service_attachment(
  p_book_id uuid,
  p_entry_id uuid,
  p_kind text,
  p_mime text,
  p_bytes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowance record;
  v_id uuid := gen_random_uuid();
  v_object_path text;
  v_thumb_path text;
begin
  if auth.uid() is null then
    raise exception 'reserve_service_attachment needs a signed-in rider' using errcode = '42501';
  end if;

  if not public.service_book_owned(p_book_id) then
    raise exception 'this service book is not one of this rider''s' using errcode = 'TT404';
  end if;
  if not public.service_book_writable(p_book_id) then
    raise exception 'this bike was handed over to a new owner, so its book no longer changes' using errcode = 'TT410';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('reserve_service_attachment:' || p_book_id::text, 0));
  if not exists (
    select 1
      from public.service_entries e
     where e.id = p_entry_id
       and e.book_id = p_book_id
       and e.deleted_at is null
  ) then
    raise exception 'entry not found in this service book' using errcode = 'TT404';
  end if;
  if exists (select 1 from public.service_entries e where e.id = p_entry_id and e.copied_from_entry_id is not null) then
    raise exception 'an entry the previous owner logged can be removed but not edited' using errcode = 'TT403';
  end if;

  if p_kind is null or p_kind not in ('receipt', 'invoice', 'photo') then
    raise exception 'an entry attachment is a receipt, an invoice or a photo' using errcode = '22023';
  end if;
  if p_mime is null or p_mime not in ('image/jpeg', 'application/pdf') then
    raise exception 'an attachment is a JPEG image or a PDF' using errcode = '22023';
  end if;
  if p_bytes is null or p_bytes <= 0 then
    raise exception 'an attachment has a size' using errcode = '22023';
  end if;

  select * into v_allowance from public.service_attachment_allowance();

  if p_bytes > v_allowance.max_bytes then
    raise exception 'one attachment may be at most % bytes', v_allowance.max_bytes using errcode = 'TT413';
  end if;

  if v_allowance.max_count is not null and (
    select count(*)
      from public.service_attachments a
     where a.book_id = p_book_id
       and (a.copied_from_attachment_id is null or a.created_by = auth.uid())
       and (a.status = 'ready' or a.created_at > now() - interval '1 day')
  ) >= v_allowance.max_count then
    raise exception 'the free plan holds % attachments per bike', v_allowance.max_count using errcode = 'TT402';
  end if;

  v_object_path := public.service_attachment_object_path(p_book_id, v_id, p_mime, false);
  v_thumb_path := public.service_attachment_object_path(p_book_id, v_id, p_mime, true);

  insert into public.service_attachments (id, book_id, entry_id, kind, object_path, thumb_path, mime, bytes, created_by)
  values (v_id, p_book_id, p_entry_id, p_kind, v_object_path, v_thumb_path, p_mime, p_bytes, auth.uid());

  return jsonb_build_object('id', v_id, 'object_path', v_object_path, 'thumb_path', v_thumb_path);
end;
$$;

revoke all on function public.reserve_service_attachment(uuid, uuid, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.reserve_service_attachment(uuid, uuid, text, text, integer) to authenticated;

-- 20261014000400's confirm, with one change: an upload still in flight when the
-- bike was handed over is not added to the seller's read-only copy (TT410).
create or replace function public.confirm_service_attachment(p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.service_attachments;
  v_writable boolean;
  v_size bigint;
  v_mime text;
  v_thumb_size bigint;
  v_thumb_mime text;
  v_max_bytes integer;
begin
  if auth.uid() is null then
    raise exception 'confirm_service_attachment needs a signed-in rider' using errcode = '42501';
  end if;

  select public.service_book_writable(a.book_id) into v_writable
    from public.service_attachments a
   where a.id = p_attachment_id
     and public.service_book_owned(a.book_id);

  select a.* into v_row
    from public.service_attachments a
   where a.id = p_attachment_id
     and public.service_book_owned(a.book_id)
   for update;

  if not found then
    raise exception 'attachment not found' using errcode = 'TT404';
  end if;
  if v_row.status = 'ready' then
    return to_jsonb(v_row);
  end if;
  if not coalesce(v_writable, false) then
    raise exception 'this bike was handed over to a new owner, so its book no longer changes' using errcode = 'TT410';
  end if;
  if v_row.created_at <= now() - interval '1 day' then
    raise exception 'the reservation has expired' using errcode = 'TT404';
  end if;

  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
    into v_size, v_mime
    from storage.objects o
   where o.bucket_id = 'service-book'
     and o.name = v_row.object_path;

  if v_size is null then
    raise exception 'the upload has not arrived' using errcode = 'TT404';
  end if;
  if v_row.thumb_path is not null then
    select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
      into v_thumb_size, v_thumb_mime
      from storage.objects o
     where o.bucket_id = 'service-book'
       and o.name = v_row.thumb_path;

    if v_thumb_size is null then
      raise exception 'the thumbnail has not arrived' using errcode = 'TT404';
    end if;
  end if;
  if v_mime is distinct from v_row.mime then
    raise exception 'the upload is not the type that was reserved' using errcode = '22023';
  end if;
  if v_row.thumb_path is not null and (v_thumb_mime is distinct from 'image/jpeg' or v_thumb_size > 1048576) then
    raise exception 'the thumbnail is not a JPEG of at most 1 MB' using errcode = '22023';
  end if;

  select a.max_bytes into v_max_bytes from public.service_attachment_allowance() a;
  if v_size > v_max_bytes then
    raise exception 'one attachment may be at most % bytes', v_max_bytes using errcode = 'TT413';
  end if;

  update public.service_attachments a
     set status = 'ready',
         uploaded_at = now(),
         bytes = v_size
   where a.id = v_row.id
  returning a.* into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.confirm_service_attachment(uuid) from public, anon, authenticated, service_role;
grant execute on function public.confirm_service_attachment(uuid) to authenticated;

-- THE HANDOVER FUNCTIONS

-- The object a seller's stored photo URL names, when it is one: the URL has to
-- be the public object endpoint of `p_bucket` with the object in the owner's
-- folder (the anchor lib/storage-photo-removal.ts applies), and the object has
-- to be in storage. Null otherwise, and a photo that names nothing is not
-- copied. security invoker; only the handover functions, running as the owner,
-- call it.
create or replace function public.service_book_transfer_photo_source(p_url text, p_bucket text, p_owner_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_name text;
begin
  if p_url is null or p_owner_id is null then
    return null;
  end if;
  v_name := substring(p_url from '/storage/v1/object/public/' || p_bucket || '/(' || p_owner_id::text || '/[^/?#]+)(?:[?#].*)?$');
  if v_name is null or not exists (
    select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = v_name
  ) then
    return null;
  end if;
  return v_name;
end;
$$;

revoke all on function public.service_book_transfer_photo_source(text, text, uuid) from public, anon, authenticated, service_role;

-- Where the buyer's copy of a photo goes: `<buyer id>/<new row id>` with the
-- source's extension, the folder the photo policies give the buyer.
create or replace function public.service_book_transfer_photo_destination(p_source text, p_buyer_id uuid, p_row_id uuid)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
           when p_source is null then null
           else p_buyer_id::text || '/' || p_row_id::text || coalesce(substring(p_source from '(\.[A-Za-z0-9]+)$'), '')
         end;
$$;

revoke all on function public.service_book_transfer_photo_destination(text, uuid, uuid) from public, anon, authenticated, service_role;

-- Whether the signed-in rider may take this handover now, raising when not:
-- TT404 for a link that is not pending or has expired, TT403 for the seller's
-- own account or an account not holding the email the seller typed, and TT402
-- for a free rider already holding a bike that is not sold (the free vehicle
-- cap, read by the rule resolveUserAccess applies). security invoker; only the
-- handover functions call it.
create or replace function public.service_book_transfer_admit(p_transfer public.service_book_transfers)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_unlimited boolean;
begin
  if p_transfer.status <> 'pending' or p_transfer.expires_at <= now() then
    raise exception 'this handover link is not valid any more' using errcode = 'TT404';
  end if;
  if auth.uid() = p_transfer.from_user_id then
    raise exception 'a bike cannot be handed over to the account selling it' using errcode = 'TT403';
  end if;
  if lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) <> p_transfer.to_email_normalized then
    raise exception 'this handover was sent to a different email address' using errcode = 'TT403';
  end if;

  select p.tier = 'pro'
         or (p.beta_access_expires_at > now()
             and (p.beta_access_started_at is null or p.beta_access_started_at <= now()))
    into v_unlimited
    from public.profiles p
   where p.id = auth.uid();

  if not coalesce(v_unlimited, false) and exists (
    select 1 from public.vehicles v where v.user_id = auth.uid() and v.sold_at is null
  ) then
    raise exception 'the free plan holds 1 vehicle' using errcode = 'TT402';
  end if;
end;
$$;

revoke all on function public.service_book_transfer_admit(public.service_book_transfers) from public, anon, authenticated, service_role;

-- The seller hands a book over: `p_token_hash` is the SHA-256 of the link's
-- token, which the server made and shows once, and `p_to_email` the address the
-- buyer will sign in with. Refuses a book that is not the caller's (TT404), a
-- sold bike (TT410), a second pending handover (TT409), the caller's own
-- address and a zone the server's clock does not know (22023). `summary` holds
-- the counts the handover screen showed, from the same rows the copy reads.
-- security definer because a rider holds no insert on the table. Returns the
-- handover's id.
create or replace function public.create_service_book_transfer(
  p_book_id uuid,
  p_to_email text,
  p_token_hash text,
  p_handover_hours numeric,
  p_handover_distance numeric,
  p_time_zone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_email text := lower(btrim(coalesce(p_to_email, '')));
  v_vehicle public.vehicles;
begin
  if auth.uid() is null then
    raise exception 'create_service_book_transfer needs a signed-in rider' using errcode = '42501';
  end if;

  select v.* into v_vehicle
    from public.service_books b
    join public.vehicles v on v.id = b.vehicle_id
   where b.id = p_book_id
     and v.user_id = auth.uid()
   for update of b;

  if not found then
    raise exception 'this service book is not one of this rider''s' using errcode = 'TT404';
  end if;
  if v_vehicle.sold_at is not null then
    raise exception 'this bike was handed over already' using errcode = 'TT410';
  end if;
  if exists (select 1 from public.service_book_transfers t where t.book_id = p_book_id and t.status = 'pending') then
    raise exception 'this bike already has a handover link; cancel it to send a new one' using errcode = 'TT409';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+$' then
    raise exception 'the buyer''s email is not an email address' using errcode = '22023';
  end if;
  if v_email = lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) then
    raise exception 'a bike cannot be handed over to the account selling it' using errcode = '22023';
  end if;
  if p_time_zone is not null and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_time_zone) then
    raise exception 'the time zone is not one the server knows' using errcode = '22023';
  end if;

  insert into public.service_book_transfers (
    book_id, from_user_id, to_email_normalized, token_hash, handover_hours,
    handover_distance, seller_time_zone, summary
  )
  values (
    p_book_id, auth.uid(), v_email, p_token_hash, p_handover_hours,
    p_handover_distance, p_time_zone,
    jsonb_build_object(
      'entries', (select count(*) from public.service_entries e where e.book_id = p_book_id and e.deleted_at is null),
      'removed_entries', (select b.transferred_removed_entry_count from public.service_books b where b.id = p_book_id)
        + (select count(*) from public.service_entries e where e.book_id = p_book_id and e.deleted_at is not null),
      'items', (select count(*) from public.service_items i where i.book_id = p_book_id),
      'readings', (select count(*) from public.vehicle_readings r where r.book_id = p_book_id and r.source in ('rider', 'transfer')),
      'attachments', (
        select count(*) from public.service_attachments a
          join public.service_entries e on e.id = a.entry_id
         where a.book_id = p_book_id and a.status = 'ready' and e.deleted_at is null
      ),
      'attachment_bytes', (
        select coalesce(sum(a.bytes), 0) from public.service_attachments a
          join public.service_entries e on e.id = a.entry_id
         where a.book_id = p_book_id and a.status = 'ready' and e.deleted_at is null
      ),
      'sessions', (select count(*) from public.sessions s where s.vehicle_id = v_vehicle.id),
      'laps', (
        select count(*) from public.session_laps l
          join public.sessions s on s.id = l.session_id
         where s.vehicle_id = v_vehicle.id
      ),
      'session_photos', (select count(*) from public.sessions s where s.vehicle_id = v_vehicle.id and s.photo_url is not null),
      'outcomes', (select count(*) from public.session_feedback f where f.vehicle_id = v_vehicle.id),
      'weights', (select count(*) from public.session_usage_weights w where w.book_id = p_book_id),
      'overrides', (select count(*) from public.service_due_overrides o where o.book_id = p_book_id)
    )
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_service_book_transfer(uuid, text, text, numeric, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.create_service_book_transfer(uuid, text, text, numeric, numeric, text) to authenticated;

-- The seller withdraws a pending handover, expired or not, so a new one can be
-- sent (TQ4). security definer because a rider holds no update on the table.
-- Returns whether a pending handover of the caller's was cancelled.
create or replace function public.cancel_service_book_transfer(p_transfer_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'cancel_service_book_transfer needs a signed-in rider' using errcode = '42501';
  end if;

  update public.service_book_transfers t
     set status = 'cancelled',
         cancelled_at = now()
   where t.id = p_transfer_id
     and t.status = 'pending'
     and t.from_user_id = auth.uid()
     and public.service_book_owned(t.book_id);

  return found;
end;
$$;

revoke all on function public.cancel_service_book_transfer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_service_book_transfer(uuid) to authenticated;

-- What the link page may show: the handover's state (`pending`, `expired`,
-- `accepted`, `cancelled` or `not_found`) and who the viewer is to it
-- (`signed_out`, `seller`, `recipient` - the account holding the address, or
-- the one that accepted - or `other`). The bike and the counts are returned
-- only to the recipient of a pending link, so a link reveals nothing to anyone
-- else. The page calls it with the service role, which holds no rider; it
-- passes the signed-in viewer's id and email. Writes nothing.
create or replace function public.describe_service_book_transfer(p_token text, p_viewer_id uuid, p_viewer_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t public.service_book_transfers;
  v_status text;
  v_viewer text;
  v_bike jsonb;
begin
  select t.* into v_t
    from public.service_book_transfers t
   where t.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  v_status := case when v_t.status = 'pending' and v_t.expires_at <= now() then 'expired' else v_t.status end;
  v_viewer := case
                when p_viewer_id is null then 'signed_out'
                when p_viewer_id = v_t.from_user_id then 'seller'
                when v_t.status = 'accepted' then case when p_viewer_id = v_t.to_user_id then 'recipient' else 'other' end
                when lower(btrim(coalesce(p_viewer_email, ''))) = v_t.to_email_normalized then 'recipient'
                else 'other'
              end;

  if v_status = 'pending' and v_viewer = 'recipient' then
    select jsonb_build_object('nickname', v.nickname, 'type', v.type, 'year', v.year, 'make', v.make, 'model', v.model, 'photo_url', v.photo_url)
      into v_bike
      from public.service_books b
      join public.vehicles v on v.id = b.vehicle_id
     where b.id = v_t.book_id;

    return jsonb_build_object('status', v_status, 'viewer', v_viewer, 'bike', v_bike, 'summary', v_t.summary, 'expires_at', v_t.expires_at);
  end if;
  if v_status = 'accepted' and v_viewer = 'recipient' then
    return jsonb_build_object('status', v_status, 'viewer', v_viewer, 'vehicle_id', v_t.new_vehicle_id);
  end if;
  return jsonb_build_object('status', v_status, 'viewer', v_viewer);
end;
$$;

revoke all on function public.describe_service_book_transfer(text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.describe_service_book_transfer(text, uuid, text) to service_role;

-- The buyer's first step: mint the new vehicle and book ids once, map every
-- session on the bike and every ready receipt of a live entry not yet mapped to
-- a fresh id (so a later call extends the maps rather than replacing them), and
-- return the storage copies the server makes before accept: each attachment's
-- file and thumbnail in `service-book`, each session photo in `session-photos`
-- and the bike photo in `vehicle-photos`, from the seller's object to the
-- buyer's. An accepted handover returns `accepted` and no copies. security
-- definer because the buyer can read none of the seller's rows.
create or replace function public.prepare_service_book_transfer_accept(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.service_book_transfers;
  v_vehicle public.vehicles;
begin
  if auth.uid() is null then
    raise exception 'prepare_service_book_transfer_accept needs a signed-in rider' using errcode = '42501';
  end if;

  select t.* into v_t
    from public.service_book_transfers t
   where t.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
   for update;

  if not found then
    raise exception 'this handover link is not valid any more' using errcode = 'TT404';
  end if;
  if v_t.status = 'accepted' and v_t.to_user_id = auth.uid() then
    return jsonb_build_object('accepted', true, 'vehicle_id', v_t.new_vehicle_id, 'book_id', v_t.new_book_id,
                              'attachments', '[]'::jsonb, 'session_photos', '[]'::jsonb, 'vehicle_photo', null);
  end if;
  perform public.service_book_transfer_admit(v_t);

  select v.* into v_vehicle
    from public.service_books b
    join public.vehicles v on v.id = b.vehicle_id
   where b.id = v_t.book_id;

  update public.service_book_transfers t
     set new_vehicle_id = coalesce(t.new_vehicle_id, gen_random_uuid()),
         new_book_id = coalesce(t.new_book_id, gen_random_uuid()),
         session_id_map = t.session_id_map || coalesce((
           select jsonb_object_agg(s.id, gen_random_uuid())
             from public.sessions s
            where s.vehicle_id = v_vehicle.id
              and not (t.session_id_map ? s.id::text)
         ), '{}'::jsonb),
         attachment_id_map = t.attachment_id_map || coalesce((
           select jsonb_object_agg(a.id, gen_random_uuid())
             from public.service_attachments a
             join public.service_entries e on e.id = a.entry_id
            where a.book_id = v_t.book_id
              and a.status = 'ready'
              and e.deleted_at is null
              and not (t.attachment_id_map ? a.id::text)
         ), '{}'::jsonb)
   where t.id = v_t.id
  returning t.* into v_t;

  return jsonb_build_object(
    'accepted', false,
    'vehicle_id', v_t.new_vehicle_id,
    'book_id', v_t.new_book_id,
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'attachment_id', n.id,
               'from_object', a.object_path,
               'to_object', public.service_attachment_object_path(v_t.new_book_id, n.id, a.mime, false),
               'from_thumb', a.thumb_path,
               'to_thumb', public.service_attachment_object_path(v_t.new_book_id, n.id, a.mime, true)
             ) order by a.created_at, a.id)
        from public.service_attachments a
        join public.service_entries e on e.id = a.entry_id
        cross join lateral (select (v_t.attachment_id_map ->> a.id::text)::uuid as id) n
       where a.book_id = v_t.book_id
         and a.status = 'ready'
         and e.deleted_at is null
    ), '[]'::jsonb),
    'session_photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'session_id', p.id,
               'from_path', p.source,
               'to_path', public.service_book_transfer_photo_destination(p.source, auth.uid(), p.id)
             ) order by p.id)
        from (
          select (v_t.session_id_map ->> s.id::text)::uuid as id,
                 public.service_book_transfer_photo_source(s.photo_url, 'session-photos', v_t.from_user_id) as source
            from public.sessions s
           where s.vehicle_id = v_vehicle.id
        ) p
       where p.source is not null
    ), '[]'::jsonb),
    'vehicle_photo', (
      select case when p.source is null then null
                  else jsonb_build_object(
                         'from_path', p.source,
                         'to_path', public.service_book_transfer_photo_destination(p.source, auth.uid(), v_t.new_vehicle_id))
             end
        from (select public.service_book_transfer_photo_source(v_vehicle.photo_url, 'vehicle-photos', v_t.from_user_id) as source) p
    )
  );
end;
$$;

revoke all on function public.prepare_service_book_transfer_accept(text) from public, anon, authenticated, service_role;
grant execute on function public.prepare_service_book_transfer_accept(text) to authenticated;

-- THE COPY, in one transaction. `p_photo_urls` is
-- `{ "vehicle": <public URL>, "sessions": { "<new session id>": <public URL> } }`,
-- the URLs of the copies the server made from prepare's list. Refuses with
-- TT409 - writing nothing - unless prepare ran, every session on the bike and
-- every ready receipt of a live entry is in its maps, every mapped receipt's
-- file and thumbnail is in storage at the size the row records, and every photo
-- prepare named is in storage and passed here. A second accept by the same
-- rider returns the first one's result. Any raise rolls everything back; the
-- copied objects are then named by no row, and the object sweep of
-- 20261014000400 removes the service-book ones after a day.
create or replace function public.accept_service_book_transfer(p_token text, p_photo_urls jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer uuid := auth.uid();
  v_t public.service_book_transfers;
  v_vehicle public.vehicles;
  v_book public.service_books;
  v_photos jsonb := coalesce(p_photo_urls, '{}'::jsonb);
  v_vehicle_photo text;
  v_session_map jsonb;
  v_field_map jsonb;
  v_item_map jsonb;
  v_entry_map jsonb;
  v_entry_item_map jsonb;
  v_reading_map jsonb;
  v_zone text;
  v_entries integer;
  v_sessions integer;
  v_attachments integer;
  v_result jsonb;
begin
  if v_buyer is null then
    raise exception 'accept_service_book_transfer needs a signed-in rider' using errcode = '42501';
  end if;
  if jsonb_typeof(v_photos) is distinct from 'object' then
    raise exception 'p_photo_urls must be an object' using errcode = '22023';
  end if;

  select t.* into v_t
    from public.service_book_transfers t
   where t.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
   for update;

  if not found then
    raise exception 'this handover link is not valid any more' using errcode = 'TT404';
  end if;
  if v_t.status = 'accepted' and v_t.to_user_id = v_buyer then
    return v_t.result;
  end if;
  perform public.service_book_transfer_admit(v_t);
  if v_t.new_vehicle_id is null then
    raise exception 'the handover has not been prepared' using errcode = 'TT409';
  end if;

  -- The seller's bike, locked: the sold check of a session insert and of every
  -- write to the book takes `for key share` on it, so each waits for this
  -- transaction and then reads the bike sold. The book's
  -- attachment lock holds a reserve off; the live entries are locked so an edit
  -- cannot slip a revision in under the copy.
  select v.* into v_vehicle
    from public.service_books b
    join public.vehicles v on v.id = b.vehicle_id
   where b.id = v_t.book_id
   for update of v;
  if v_vehicle.sold_at is not null then
    raise exception 'this bike was handed over already' using errcode = 'TT410';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('reserve_service_attachment:' || v_t.book_id::text, 0));
  select b.* into v_book from public.service_books b where b.id = v_t.book_id for update;
  perform 1 from public.service_entries e where e.book_id = v_book.id and e.deleted_at is null for update;

  if exists (
    select 1 from public.sessions s
     where s.vehicle_id = v_vehicle.id
       and not (v_t.session_id_map ? s.id::text)
  ) or exists (
    select 1 from public.service_attachments a
      join public.service_entries e on e.id = a.entry_id
     where a.book_id = v_book.id
       and a.status = 'ready'
       and e.deleted_at is null
       and not (v_t.attachment_id_map ? a.id::text)
  ) then
    raise exception 'the bike changed since the handover was prepared' using errcode = 'TT409';
  end if;

  if exists (
    select 1
      from public.service_attachments a
      join public.service_entries e on e.id = a.entry_id
      cross join lateral (select (v_t.attachment_id_map ->> a.id::text)::uuid as id) n
     where a.book_id = v_book.id
       and a.status = 'ready'
       and e.deleted_at is null
       and (
         not exists (
           select 1 from storage.objects o
            where o.bucket_id = 'service-book'
              and o.name = public.service_attachment_object_path(v_t.new_book_id, n.id, a.mime, false)
              and (o.metadata ->> 'size')::bigint = a.bytes
         )
         or (a.thumb_path is not null and not exists (
           select 1 from storage.objects o
            where o.bucket_id = 'service-book'
              and o.name = public.service_attachment_object_path(v_t.new_book_id, n.id, a.mime, true)
         ))
       )
  ) then
    raise exception 'a receipt has not been copied yet' using errcode = 'TT409';
  end if;

  select jsonb_object_agg(s.id, v_t.session_id_map -> s.id::text) into v_session_map
    from public.sessions s
   where s.vehicle_id = v_vehicle.id;
  v_session_map := coalesce(v_session_map, '{}'::jsonb);

  if exists (
    select 1
      from public.sessions s
      cross join lateral (
        select public.service_book_transfer_photo_destination(
                 public.service_book_transfer_photo_source(s.photo_url, 'session-photos', v_t.from_user_id),
                 v_buyer,
                 (v_session_map ->> s.id::text)::uuid) as path
      ) d
     where s.vehicle_id = v_vehicle.id
       and d.path is not null
       and (
         right(coalesce(v_photos -> 'sessions' ->> (v_session_map ->> s.id::text), ''), length(d.path) + 41)
           is distinct from '/storage/v1/object/public/session-photos/' || d.path
         or not exists (select 1 from storage.objects o where o.bucket_id = 'session-photos' and o.name = d.path)
       )
  ) then
    raise exception 'a session photo has not been copied yet' using errcode = 'TT409';
  end if;

  v_vehicle_photo := public.service_book_transfer_photo_destination(
    public.service_book_transfer_photo_source(v_vehicle.photo_url, 'vehicle-photos', v_t.from_user_id),
    v_buyer,
    v_t.new_vehicle_id);
  if v_vehicle_photo is not null and (
    right(coalesce(v_photos ->> 'vehicle', ''), length(v_vehicle_photo) + 41)
      is distinct from '/storage/v1/object/public/vehicle-photos/' || v_vehicle_photo
    or not exists (select 1 from storage.objects o where o.bucket_id = 'vehicle-photos' and o.name = v_vehicle_photo)
  ) then
    raise exception 'the bike photo has not been copied yet' using errcode = 'TT409';
  end if;

  -- The buyer's bike and book.
  insert into public.vehicles (id, user_id, nickname, type, year, make, model, photo_url)
  values (v_t.new_vehicle_id, v_buyer, v_vehicle.nickname, v_vehicle.type, v_vehicle.year, v_vehicle.make, v_vehicle.model,
          case when v_vehicle_photo is null then null else v_photos ->> 'vehicle' end);

  insert into public.service_books (
    id, vehicle_id, tracks_hours, tracks_distance, distance_unit, default_session_minutes,
    default_session_distance, transferred_from_book_id, transferred_at, transferred_removed_entry_count,
    owner_time_zone
  )
  values (
    v_t.new_book_id, v_t.new_vehicle_id, v_book.tracks_hours, v_book.tracks_distance, v_book.distance_unit,
    v_book.default_session_minutes, v_book.default_session_distance, v_book.id, now(),
    v_book.transferred_removed_entry_count
      + (select count(*) from public.service_entries e where e.book_id = v_book.id and e.deleted_at is not null),
    coalesce(v_book.owner_time_zone, v_t.seller_time_zone)
  );

  -- The layout and the items, each through a map from the seller's id to a new one.
  select coalesce(jsonb_object_agg(f.id, gen_random_uuid()), '{}'::jsonb) into v_field_map
    from public.service_book_fields f where f.book_id = v_book.id;
  insert into public.service_book_fields (id, book_id, builtin_key, label, field_type, options, enabled, required, sort_order, created_at, updated_at)
  select (v_field_map ->> f.id::text)::uuid, v_t.new_book_id, f.builtin_key, f.label, f.field_type, f.options,
         f.enabled, f.required, f.sort_order, f.created_at, f.updated_at
    from public.service_book_fields f where f.book_id = v_book.id;

  select coalesce(jsonb_object_agg(i.id, gen_random_uuid()), '{}'::jsonb) into v_item_map
    from public.service_items i where i.book_id = v_book.id;
  insert into public.service_items (id, book_id, name, interval_hours, interval_distance, interval_days, source, sort_order, archived_at, created_at, updated_at)
  select (v_item_map ->> i.id::text)::uuid, v_t.new_book_id, i.name, i.interval_hours, i.interval_distance, i.interval_days,
         i.source, i.sort_order, i.archived_at, i.created_at, i.updated_at
    from public.service_items i where i.book_id = v_book.id;

  -- Every live entry, carrying its provenance, at the seller's revision plus
  -- one: the triggers write that revision as `transferred` and the entry's
  -- reading on the seller's `logged_at`.
  select coalesce(jsonb_object_agg(e.id, gen_random_uuid()), '{}'::jsonb) into v_entry_map
    from public.service_entries e where e.book_id = v_book.id and e.deleted_at is null;
  insert into public.service_entries (
    id, book_id, service_date, reading_hours, reading_distance, performed_by, shop_name, cost_cents,
    currency, notes, custom_fields, origin, logged_at, logged_by, revision, copied_from_entry_id, created_at
  )
  select (v_entry_map ->> e.id::text)::uuid, v_t.new_book_id, e.service_date, e.reading_hours, e.reading_distance,
         e.performed_by, e.shop_name, e.cost_cents, e.currency, e.notes,
         (select coalesce(jsonb_object_agg(coalesce(v_field_map ->> c.key, c.key), c.value), '{}'::jsonb)
            from jsonb_each(e.custom_fields) c),
         e.origin, e.logged_at, e.logged_by, e.revision + 1, e.id, e.created_at
    from public.service_entries e
   where v_entry_map ? e.id::text
   order by e.created_at, e.id;
  get diagnostics v_entries = row_count;

  select coalesce(jsonb_object_agg(i.id, gen_random_uuid()), '{}'::jsonb) into v_entry_item_map
    from public.service_entry_items i where v_entry_map ? i.entry_id::text;
  insert into public.service_entry_items (id, entry_id, item_id, label, created_at)
  select (v_entry_item_map ->> i.id::text)::uuid, (v_entry_map ->> i.entry_id::text)::uuid,
         (v_item_map ->> i.item_id::text)::uuid, i.label, i.created_at
    from public.service_entry_items i where v_entry_map ? i.entry_id::text;

  insert into public.service_entry_parts (entry_id, entry_item_id, brand, part_number, quantity, unit_cost_cents, created_at)
  select (v_entry_map ->> p.entry_id::text)::uuid, (v_entry_item_map ->> p.entry_item_id::text)::uuid,
         p.brand, p.part_number, p.quantity, p.unit_cost_cents, p.created_at
    from public.service_entry_parts p where v_entry_map ? p.entry_id::text;

  -- The seller's history under it, verbatim: their snapshots name their own
  -- ids, as a record of what was.
  insert into public.service_entry_revisions (entry_id, revision, kind, snapshot, changed_at, changed_by, transaction_id)
  select (v_entry_map ->> r.entry_id::text)::uuid, r.revision, r.kind, r.snapshot, r.changed_at, r.changed_by, r.transaction_id
    from public.service_entry_revisions r where v_entry_map ? r.entry_id::text;

  -- Rider and handover readings; an entry's own reading came over with it.
  select coalesce(jsonb_object_agg(r.id, gen_random_uuid()), '{}'::jsonb) into v_reading_map
    from public.vehicle_readings r where r.book_id = v_book.id and r.source in ('rider', 'transfer');
  insert into public.vehicle_readings (id, book_id, reading_date, read_at, hours, distance, source, supersedes_id, created_at, updated_at)
  select (v_reading_map ->> r.id::text)::uuid, v_t.new_book_id, r.reading_date, r.read_at, r.hours, r.distance, r.source,
         (v_reading_map ->> r.supersedes_id::text)::uuid, r.created_at, r.updated_at
    from public.vehicle_readings r where v_reading_map ? r.id::text;

  if (select count(*) from public.vehicle_readings r where r.book_id = v_t.new_book_id and r.source = 'entry')
     <> (select count(*) from public.vehicle_readings r
           join public.service_entries e on e.id = r.entry_id
          where r.book_id = v_book.id and r.source = 'entry' and e.deleted_at is null) then
    raise exception 'the copied entries did not bring their readings' using errcode = 'P0001';
  end if;

  -- Every session on the bike and what hangs off it. A track the seller made
  -- is theirs and private, so a copied session keeps only the name of one;
  -- a seeded circuit and its layout are kept.
  insert into public.sessions (
    id, user_id, vehicle_id, track_id, track_name, layout_id, layout_name, date, start_time, session_number,
    conditions, tires, suspension, alignment, enabled_modules, extra_modules, notes, photo_url,
    copied_from_session_id, original_user_id, created_at, updated_at
  )
  select (v_session_map ->> s.id::text)::uuid, v_buyer, v_t.new_vehicle_id,
         case when t.is_seeded then s.track_id end, s.track_name,
         case when t.is_seeded then s.layout_id end, s.layout_name,
         s.date, s.start_time, s.session_number, s.conditions, s.tires, s.suspension, s.alignment,
         s.enabled_modules, s.extra_modules, s.notes,
         case
           when public.service_book_transfer_photo_source(s.photo_url, 'session-photos', v_t.from_user_id) is null then null
           else v_photos -> 'sessions' ->> (v_session_map ->> s.id::text)
         end,
         s.id, coalesce(s.original_user_id, s.user_id), s.created_at, s.updated_at
    from public.sessions s
    left join public.tracks t on t.id = s.track_id
   where s.vehicle_id = v_vehicle.id;
  get diagnostics v_sessions = row_count;

  insert into public.session_laps (user_id, session_id, lap_number, lap_time_ms, included, source, created_at, updated_at)
  select v_buyer, (v_session_map ->> l.session_id::text)::uuid, l.lap_number, l.lap_time_ms, l.included, l.source, l.created_at, l.updated_at
    from public.session_laps l where v_session_map ? l.session_id::text;

  insert into public.session_environment (
    user_id, session_id, ambient_temperature_c, track_temperature_c, humidity_percent,
    weather_condition, surface_condition, source, created_at, updated_at
  )
  select v_buyer, (v_session_map ->> x.session_id::text)::uuid, x.ambient_temperature_c, x.track_temperature_c,
         x.humidity_percent, x.weather_condition, x.surface_condition, x.source, x.created_at, x.updated_at
    from public.session_environment x where v_session_map ? x.session_id::text;

  insert into public.telemetry_summaries (user_id, session_id, vehicle_id, source, summary, metrics, created_at, updated_at)
  select v_buyer, (v_session_map ->> x.session_id::text)::uuid, v_t.new_vehicle_id, x.source, x.summary, x.metrics,
         x.created_at, x.updated_at
    from public.telemetry_summaries x where v_session_map ? x.session_id::text;

  -- The outcome a rider logged is theirs; the Race Engineer recommendation it
  -- rated was advice to the seller and stays with them.
  insert into public.session_feedback (
    user_id, session_id, vehicle_id, track_id, recommendation_id, outcome, rider_confidence, symptoms,
    notes, lap_time_delta_ms, reference_session_id, recommendation_helpfulness, created_at, updated_at
  )
  select v_buyer, (v_session_map ->> x.session_id::text)::uuid, v_t.new_vehicle_id,
         case when t.is_seeded then x.track_id end, null, x.outcome, x.rider_confidence, x.symptoms,
         x.notes, x.lap_time_delta_ms, (v_session_map ->> x.reference_session_id::text)::uuid, null,
         x.created_at, x.updated_at
    from public.session_feedback x
    left join public.tracks t on t.id = x.track_id
   where v_session_map ? x.session_id::text;

  insert into public.session_changes (
    user_id, session_id, vehicle_id, reference_kind, reference_session_id, reference_label,
    reference_date, changes, created_at, updated_at
  )
  select v_buyer, (v_session_map ->> x.session_id::text)::uuid, v_t.new_vehicle_id, x.reference_kind,
         (v_session_map ->> x.reference_session_id::text)::uuid, x.reference_label, x.reference_date,
         x.changes, x.created_at, x.updated_at
    from public.session_changes x where v_session_map ? x.session_id::text;

  -- The rider's word on the book: session weights and due overrides.
  insert into public.session_usage_weights (book_id, session_id, weight, minutes_override, distance_override, note, created_at, updated_at)
  select v_t.new_book_id, (v_session_map ->> w.session_id::text)::uuid, w.weight, w.minutes_override,
         w.distance_override, w.note, w.created_at, w.updated_at
    from public.session_usage_weights w
   where w.book_id = v_book.id and v_session_map ? w.session_id::text;

  insert into public.service_due_overrides (
    book_id, item_id, kind, until_date, until_hours, until_distance, anchor_hours, anchor_distance, note, created_at
  )
  select v_t.new_book_id, (v_item_map ->> o.item_id::text)::uuid, o.kind, o.until_date, o.until_hours,
         o.until_distance, o.anchor_hours, o.anchor_distance, o.note, o.created_at
    from public.service_due_overrides o where o.book_id = v_book.id;

  -- The receipts, as uploaded (TQ6), at the paths prepare named.
  insert into public.service_attachments (
    id, book_id, entry_id, kind, object_path, thumb_path, mime, bytes, status, uploaded_at, created_by,
    created_at, copied_from_attachment_id
  )
  select n.id, v_t.new_book_id, (v_entry_map ->> a.entry_id::text)::uuid, a.kind,
         public.service_attachment_object_path(v_t.new_book_id, n.id, a.mime, false),
         public.service_attachment_object_path(v_t.new_book_id, n.id, a.mime, true),
         a.mime, a.bytes, 'ready', a.uploaded_at, a.created_by, a.created_at, a.id
    from public.service_attachments a
    cross join lateral (select (v_t.attachment_id_map ->> a.id::text)::uuid as id) n
   where a.book_id = v_book.id
     and a.status = 'ready'
     and v_entry_map ? a.entry_id::text;
  get diagnostics v_attachments = row_count;

  -- The reading at handover closes the seller's copy and opens the buyer's,
  -- dated the day in the book's zone.
  if v_t.handover_hours is not null or v_t.handover_distance is not null then
    v_zone := coalesce(v_book.owner_time_zone, v_t.seller_time_zone, 'UTC');
    insert into public.vehicle_readings (book_id, reading_date, hours, distance, source)
    values (v_book.id, (now() at time zone v_zone)::date, v_t.handover_hours, v_t.handover_distance, 'transfer'),
           (v_t.new_book_id, (now() at time zone v_zone)::date, v_t.handover_hours, v_t.handover_distance, 'transfer');
  end if;

  update public.service_books b
     set owner_time_zone = v_t.seller_time_zone
   where b.id = v_book.id
     and b.owner_time_zone is null
     and v_t.seller_time_zone is not null;

  update public.vehicles v set sold_at = now() where v.id = v_vehicle.id;

  v_result := jsonb_build_object(
    'vehicle_id', v_t.new_vehicle_id,
    'book_id', v_t.new_book_id,
    'entries', v_entries,
    'sessions', v_sessions,
    'attachments', v_attachments
  );

  update public.service_book_transfers t
     set status = 'accepted',
         to_user_id = v_buyer,
         accepted_at = now(),
         result = v_result
   where t.id = v_t.id;

  return v_result;
end;
$$;

revoke all on function public.accept_service_book_transfer(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.accept_service_book_transfer(text, jsonb) to authenticated;
