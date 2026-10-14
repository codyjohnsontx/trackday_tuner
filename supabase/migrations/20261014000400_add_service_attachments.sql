-- Receipts, invoices and photos on a service book entry.
--
-- Owner decisions, 2026-10-08: an entry can carry attachments for receipts,
-- invoices and photos (Q3); the core book is free with a reasonable attachment
-- allowance and Pro gets unlimited attachments (Q7); and on the Supabase free
-- plan (1 GB storage, 5 GB egress) the free allowance is 25 attachments per bike
-- at 10 MB each (PQ3). Pro is held only to the bucket's 25 MB per file.
--
-- THE BUCKET IS PRIVATE AND NO RIDER POLICY TOUCHES IT. `service-book` is
-- declared `public = false` in supabase/config.toml, and this file writes no
-- policy on storage.objects for it, so neither `anon` nor `authenticated` can
-- read, list or write an object there through the Storage API. Every write is
-- a signed upload URL the server mints for a path this file chose, and every
-- read is a signed URL the server mints after the rider's own select of the
-- row - so who may see a receipt is decided by the row's RLS, once.
--
-- A WRITE IS RESERVED, UPLOADED, THEN CONFIRMED:
--
-- 1. `reserve_service_attachment` takes a per-book lock, checks the rider owns
--    the book and the entry, counts the book's attachments against the
--    allowance, and inserts a `pending` row whose object path it mints:
--    `<book id>/<attachment id>.jpg` (with `.thumb.jpg` beside it) or `.pdf`.
--    Over the count is TT402 and over the per-file size TT413. The count holds
--    every `ready` row and every `pending` row younger than a day, so two
--    reserves racing for the last slot cannot both get it: the second waits on
--    the lock and then counts the first.
-- 2. The server mints a signed upload URL for each path and the browser uploads
--    straight to storage, resized first, so no photo passes through a function.
-- 3. `confirm_service_attachment` flips the row to `ready` only once the object
--    is really there: it reads storage.objects for the path, and refuses an
--    object missing, of another type, or over the rider's per-file size. The
--    size kept on the row is the stored object's, not the one the browser
--    declared. `uploaded_at` is set here and nowhere else, and it is what the
--    "Receipt attached when logged" label reads.
--
-- A reservation nobody confirms - a closed tab, a failed upload - is swept: a
-- daily pg_cron job deletes `pending` rows older than a day, and /api/health's
-- `attachment_sweep` check fails when one is more than two days old, which is
-- what proves the job runs. A signed upload URL lives two hours, so nothing can
-- arrive for a row once it is old enough to sweep. SQL cannot delete the object
-- itself (storage.objects refuses a direct delete), so an object uploaded for a
-- swept row stays in the bucket; the app removes the objects of an upload it
-- sees fail.
--
-- An attachment is not part of the entry's snapshot, so adding one writes no
-- revision and an entry stays "Unedited". `entry_id` is required for the kinds
-- this file accepts; `manual_page` and `book_page` are in the check for the
-- photo-reading slice, which writes them through a function of its own.

create table if not exists public.service_attachments (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.service_books(id) on delete cascade,
  entry_id uuid references public.service_entries(id) on delete cascade,
  kind text not null check (kind in ('receipt', 'invoice', 'photo', 'manual_page', 'book_page')),
  object_path text not null unique,
  thumb_path text unique,
  mime text not null check (mime in ('image/jpeg', 'application/pdf')),
  bytes integer not null check (bytes > 0),
  status text not null default 'pending' check (status in ('pending', 'ready')),
  uploaded_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint service_attachments_ready_is_uploaded check ((status = 'ready') = (uploaded_at is not null))
);

create index if not exists service_attachments_book_idx on public.service_attachments(book_id, status);
create index if not exists service_attachments_entry_idx on public.service_attachments(entry_id);
create index if not exists service_attachments_pending_idx
  on public.service_attachments(created_at)
  where status = 'pending';

alter table public.service_attachments enable row level security;

create policy "service_attachments: select own"
  on public.service_attachments for select
  using (public.service_book_owned(book_id));

-- Reads only: every write goes through the functions below.
revoke all on public.service_attachments from public, anon, authenticated;
grant select on public.service_attachments to authenticated;

-- What the calling rider may attach: how many per bike (null is unlimited) and
-- how large one file may be. Pro is the rule `resolveUserAccess` (lib/access.ts)
-- applies and create_session_with_laps (20260928002300) mirrors; 25 and the two
-- sizes are the numbers lib/plans.ts prints. tests/db/service-attachments.spec.ts
-- holds this to both, on a real database. security invoker: it reads only the
-- rider's own profile.
create or replace function public.service_attachment_allowance(out max_count integer, out max_bytes integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select case when a.unlimited then null else 25 end,
         case when a.unlimited then 26214400 else 10485760 end
    from (
      select coalesce((
        select p.tier = 'pro'
               or (p.beta_access_expires_at > now()
                   and (p.beta_access_started_at is null or p.beta_access_started_at <= now()))
          from public.profiles p
         where p.id = auth.uid()
      ), false) as unlimited
    ) a;
$$;

revoke all on function public.service_attachment_allowance() from public, anon, authenticated, service_role;
grant execute on function public.service_attachment_allowance() to authenticated;

-- security definer because a rider holds no insert on the table, so the cap
-- cannot be skipped by inserting directly. It acts only for `auth.uid()`, on a
-- book and a live entry that rider owns. Returns the row's id and paths.
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

  perform pg_advisory_xact_lock(hashtextextended('reserve_service_attachment:' || p_book_id::text, 0));

  if not public.service_book_owned(p_book_id) then
    raise exception 'this service book is not one of this rider''s' using errcode = 'TT404';
  end if;
  if not exists (
    select 1
      from public.service_entries e
     where e.id = p_entry_id
       and e.book_id = p_book_id
       and e.deleted_at is null
  ) then
    raise exception 'entry not found in this service book' using errcode = 'TT404';
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
       and (a.status = 'ready' or a.created_at > now() - interval '1 day')
  ) >= v_allowance.max_count then
    raise exception 'the free plan holds % attachments per bike', v_allowance.max_count using errcode = 'TT402';
  end if;

  if p_mime = 'image/jpeg' then
    v_object_path := p_book_id::text || '/' || v_id::text || '.jpg';
    v_thumb_path := p_book_id::text || '/' || v_id::text || '.thumb.jpg';
  else
    v_object_path := p_book_id::text || '/' || v_id::text || '.pdf';
  end if;

  insert into public.service_attachments (id, book_id, entry_id, kind, object_path, thumb_path, mime, bytes, created_by)
  values (v_id, p_book_id, p_entry_id, p_kind, v_object_path, v_thumb_path, p_mime, p_bytes, auth.uid());

  return jsonb_build_object('id', v_id, 'object_path', v_object_path, 'thumb_path', v_thumb_path);
end;
$$;

-- A rider calls it; nobody else may. Revoked from service_role by name, because
-- the hosted project hands execute on every new public function to it.
revoke all on function public.reserve_service_attachment(uuid, uuid, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.reserve_service_attachment(uuid, uuid, text, text, integer) to authenticated;

-- security definer because it writes a row a rider holds no update on, and
-- reads storage.objects, which no rider policy reaches in this bucket. It
-- confirms only a pending row of a book the caller owns, and only what storage
-- actually holds. Returns the confirmed row.
create or replace function public.confirm_service_attachment(p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.service_attachments;
  v_size bigint;
  v_mime text;
  v_max_bytes integer;
begin
  if auth.uid() is null then
    raise exception 'confirm_service_attachment needs a signed-in rider' using errcode = '42501';
  end if;

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

  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
    into v_size, v_mime
    from storage.objects o
   where o.bucket_id = 'service-book'
     and o.name = v_row.object_path;

  if v_size is null then
    raise exception 'the upload has not arrived' using errcode = 'TT404';
  end if;
  if v_row.thumb_path is not null and not exists (
    select 1 from storage.objects o where o.bucket_id = 'service-book' and o.name = v_row.thumb_path
  ) then
    raise exception 'the thumbnail has not arrived' using errcode = 'TT404';
  end if;
  if v_mime is distinct from v_row.mime then
    raise exception 'the upload is not the type that was reserved' using errcode = '22023';
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

-- Deletes every reservation nobody confirmed within a day. security definer so
-- the cron job needs no grant on the table. Returns how many rows it removed.
create or replace function public.purge_stale_service_attachments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.service_attachments
   where status = 'pending'
     and created_at < now() - interval '1 day';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_stale_service_attachments() from public, anon, authenticated, service_role;
grant execute on function public.purge_stale_service_attachments() to service_role;

-- cron.schedule with a job name replaces a job of that name, so re-running this
-- file leaves one job rather than two.
create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;

select cron.schedule(
  'purge-stale-service-attachments',
  '41 4 * * *',
  $$select public.purge_stale_service_attachments()$$
);
