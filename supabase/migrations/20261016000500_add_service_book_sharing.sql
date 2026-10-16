-- A service book shared by link, and the owner's time zone that a shared book is
-- labelled in.
--
-- Owner decisions, 2026-10-08 and 2026-10-16: a seller can share a read-only
-- copy of a bike's book that anyone holding the link can view, with no account
-- (Q5); that view labels every entry honestly - logged the day of service or
-- back-filled later, edited or not (Q4); and an entry the owner removed shows
-- there only as "N entries removed by the owner", never its content (PQ6).
--
-- A LINK IS A TOKEN NOBODY STORES. The server makes 32 random bytes, shows the
-- link to the owner once, and keeps only the SHA-256 of it, as the beta invites
-- do, so a read of this table cannot open a book. A link is revoked, never
-- deleted: `revoked_at` is dated by the server and, once set, never cleared, so
-- a revoked link stays revoked whoever writes the row. The view count and the
-- last view are the server's; a rider writes neither.
--
-- THE SHARED PAGE READS THROUGH THE SERVICE ROLE, AND ONLY THROUGH
-- `open_service_book_share`. anon gets nothing here: the page hashes the token,
-- and this function answers which book an unrevoked link opens, after holding
-- that link to a rate limit (a leaked link must not run up the storage egress
-- every page view costs), and counts the view. The page then reads that one
-- book with the service role and prints only what a buyer may see.
--
-- THE OWNER'S ZONE. "Logged the day of service" means the day in the zone of
-- whoever logged it, and the app stored no zone for a rider: the owner's own
-- screens use the zone of the browser looking at them. A buyer's browser is
-- somewhere else, so a shared book is labelled in `owner_time_zone`, which the
-- owner's browser writes when they open their book and when they make a link.
-- The check holds only the shape of an IANA name; the server checks the zone is
-- one its clock knows before writing it, and the shared page treats a stored
-- zone it cannot use as absent rather than labelling in another one.

alter table public.service_books
  add column if not exists owner_time_zone text
    check (owner_time_zone is null or owner_time_zone ~ '^[A-Za-z0-9_+/-]{1,64}$');

grant update (owner_time_zone) on public.service_books to authenticated;

create table if not exists public.service_book_shares (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.service_books(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  view_count integer not null default 0 check (view_count >= 0),
  last_viewed_at timestamptz
);

create index if not exists service_book_shares_book_idx on public.service_book_shares(book_id);

-- On a rider's insert the clock, the rider and the counters are the server's.
-- On every update, by anyone, the link's book, token and maker cannot change,
-- and a revoke is dated by the server and never undone. security invoker on
-- purpose: `current_user` is what tells a Data API write from the owner's.
create or replace function public.service_book_shares_pin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated', 'service_role') then
      new.created_at := now();
      new.created_by := coalesce(auth.uid(), new.created_by);
      new.view_count := 0;
      new.last_viewed_at := null;
      if new.revoked_at is not null then
        new.revoked_at := now();
      end if;
    end if;
    return new;
  end if;

  new.book_id := old.book_id;
  new.token_hash := old.token_hash;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if old.revoked_at is not null then
    new.revoked_at := old.revoked_at;
  elsif new.revoked_at is not null then
    new.revoked_at := now();
  end if;
  return new;
end;
$$;

create or replace trigger service_book_shares_pin
  before insert or update on public.service_book_shares
  for each row execute function public.service_book_shares_pin();

alter table public.service_book_shares enable row level security;

create policy "service_book_shares: select own"
  on public.service_book_shares for select
  using (public.service_book_owned(book_id));

create policy "service_book_shares: insert own"
  on public.service_book_shares for insert
  with check (public.service_book_owned(book_id));

create policy "service_book_shares: update own"
  on public.service_book_shares for update
  using (public.service_book_owned(book_id))
  with check (public.service_book_owned(book_id));

-- A rider makes a link and revokes it; nothing else. No delete for any API
-- role but the service role, which the book's cascade does not need either.
revoke all on public.service_book_shares from public, anon, authenticated;
grant select on public.service_book_shares to authenticated;
grant insert (book_id, token_hash) on public.service_book_shares to authenticated;
grant update (revoked_at) on public.service_book_shares to authenticated;

-- Which book an unrevoked link opens, or null for a link that is not one. A
-- link that opens a book is held to `p_limit` uses per `p_window_seconds`
-- (consume_beta_rate_limit, keyed on the token's hash so no address is
-- stored); over it, `rate_limited` is true and no book is named. A use within
-- the limit counts as a view when `p_count_view` is true - the page - and not
-- when it is false - a tap on one of its attachments, which spends the same
-- budget. A link that opens nothing writes nothing, so a guessed token leaves
-- no row behind. security invoker: only the service role calls it, and it
-- holds the table already.
create or replace function public.open_service_book_share(
  p_token_hash text,
  p_count_view boolean,
  p_limit integer,
  p_window_seconds integer
)
returns table (book_id uuid, rate_limited boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_share_id uuid;
  v_book_id uuid;
begin
  select s.id, s.book_id
    into v_share_id, v_book_id
    from public.service_book_shares s
   where s.token_hash = p_token_hash
     and s.revoked_at is null;

  if v_share_id is null then
    return;
  end if;

  if public.consume_beta_rate_limit('service-book-share:' || p_token_hash, p_limit, p_window_seconds) then
    book_id := null;
    rate_limited := true;
    return next;
    return;
  end if;

  if p_count_view then
    update public.service_book_shares s
       set view_count = s.view_count + 1,
           last_viewed_at = now()
     where s.id = v_share_id;
  end if;

  book_id := v_book_id;
  rate_limited := false;
  return next;
end;
$$;

-- The shared page calls it with the service role; no rider and no visitor may.
-- Revoked from service_role by name first, because the hosted project hands
-- execute on every new public function to it, so the grant below is the
-- decision rather than a default.
revoke all on function public.open_service_book_share(text, boolean, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.open_service_book_share(text, boolean, integer, integer) to service_role;

-- The pin cannot be called directly - it returns `trigger` - but the execute
-- decision is written down here as for every function this file creates.
revoke all on function public.service_book_shares_pin() from public, anon, authenticated, service_role;
