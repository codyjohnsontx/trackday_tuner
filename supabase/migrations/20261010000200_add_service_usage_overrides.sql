-- Where the rider overrides the service book's suggestions (owner, 2026-10-08):
-- "Sometimes doing a day at a smaller track won't warrant an oil change but a
-- big day somewhere like cota would. But allow the user to make that decision."
--
-- Usage estimated from logged sessions and the due state worked out from it are
-- suggestions. Two tables hold the rider's word on them; the rules that read
-- these are application code in a later change, and nothing here computes a due
-- date.
--
-- `session_usage_weights`: how much one logged session counts toward a book's
-- usage estimate. Weight 0 is "this day does not count", 2 is a big day; the
-- minutes and distance overrides replace the estimate for that session outright.
-- The session must be on the book's own vehicle, so a weight cannot count a
-- session from another bike, or another rider, toward this one.
--
-- `service_due_overrides`: a snooze, a skipped cycle, or a next-due the rider
-- set by hand, per item. The newest per item wins, which is why `created_at` is
-- the server's: a row dated ahead would win for good.

create table if not exists public.session_usage_weights (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.service_books(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  weight numeric not null default 1 check (weight >= 0 and weight <= 3),
  minutes_override integer check (minutes_override >= 0),
  distance_override numeric check (distance_override >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_usage_weights_once unique (book_id, session_id)
);

create index if not exists session_usage_weights_session_idx
  on public.session_usage_weights(session_id);

create or replace trigger session_usage_weights_set_updated_at
  before update on public.session_usage_weights
  for each row execute function public.set_updated_at();

create table if not exists public.service_due_overrides (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.service_books(id) on delete cascade,
  item_id uuid not null references public.service_items(id) on delete cascade,
  kind text not null check (kind in ('snooze', 'skip_cycle', 'set_next_due')),
  until_date date,
  until_hours numeric check (until_hours >= 0),
  until_distance numeric check (until_distance >= 0),
  anchor_hours numeric check (anchor_hours >= 0),
  anchor_distance numeric check (anchor_distance >= 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists service_due_overrides_item_created_idx
  on public.service_due_overrides(item_id, created_at desc);

alter table public.session_usage_weights enable row level security;
alter table public.service_due_overrides enable row level security;

create policy "session_usage_weights: select own"
  on public.session_usage_weights for select
  using (public.service_book_owned(book_id));

create policy "session_usage_weights: insert own"
  on public.session_usage_weights for insert
  with check (
    public.service_book_owned(book_id)
    and exists (
      select 1
        from public.sessions s
        join public.service_books b on b.vehicle_id = s.vehicle_id
       where s.id = session_usage_weights.session_id
         and b.id = session_usage_weights.book_id
         and s.user_id = auth.uid()
    )
  );

create policy "session_usage_weights: update own"
  on public.session_usage_weights for update
  using (public.service_book_owned(book_id));

create policy "session_usage_weights: delete own"
  on public.session_usage_weights for delete
  using (public.service_book_owned(book_id));

create policy "service_due_overrides: select own"
  on public.service_due_overrides for select
  using (public.service_book_owned(book_id));

-- The item must be one of the same book's, or an override could quiet another
-- bike's reminder.
create policy "service_due_overrides: insert own"
  on public.service_due_overrides for insert
  with check (
    public.service_book_owned(book_id)
    and exists (
      select 1
        from public.service_items i
       where i.id = service_due_overrides.item_id
         and i.book_id = service_due_overrides.book_id
    )
  );

create policy "service_due_overrides: update own"
  on public.service_due_overrides for update
  using (public.service_book_owned(book_id));

-- The book and session a weight names, and the book and item an override names,
-- are fixed once written: a correction is a new row, so neither column is in an
-- update grant. Withdrawing a weight is deleting it; an override is superseded
-- by a newer one rather than removed.
revoke all on public.session_usage_weights from public, anon, authenticated;
grant select, delete on public.session_usage_weights to authenticated;
grant insert (id, book_id, session_id, weight, minutes_override, distance_override, note)
  on public.session_usage_weights to authenticated;
grant update (weight, minutes_override, distance_override, note)
  on public.session_usage_weights to authenticated;

revoke all on public.service_due_overrides from public, anon, authenticated;
grant select on public.service_due_overrides to authenticated;
grant insert (id, book_id, item_id, kind, until_date, until_hours, until_distance, anchor_hours, anchor_distance, note)
  on public.service_due_overrides to authenticated;
grant update (until_date, until_hours, until_distance, anchor_hours, anchor_distance, note)
  on public.service_due_overrides to authenticated;
