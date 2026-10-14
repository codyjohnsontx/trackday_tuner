-- One save of a service entry is one transaction, so it is one revision.
--
-- 20261010000100 records a revision for every committed transaction that
-- changes an entry's snapshot, and the snapshot holds the entry's items and
-- parts. PostgREST writes one table per request and supabase-js has no
-- transactions, so an entry saved from the website with its items and parts was
-- three requests - and read "Edited 2 times" on the book page the moment it was
-- saved, measured against a stack built from these migrations. The owner's
-- honest-history rule (2026-10-08, Q4) is that "unedited" and "edited N times"
-- are what a buyer reads, so a save has to be one transaction, and the only
-- place that exists is a SQL function.
--
-- `security invoker`, on purpose: it runs as the rider, so RLS still chooses
-- the rows and the per-column grants of 20261010000100 still decide what may be
-- written - `logged_at`, `logged_by`, `revision` and `deleted_at` are not
-- reachable here any more than through PostgREST - and the pin, the history and
-- the reading triggers run exactly as they do for a plain insert. It widens
-- nothing; it only joins three writes into one transaction.
--
-- Items and parts are RECONCILED rather than replaced: a stored row that the
-- save still wants is kept, so its id stays and a save that changes nothing
-- leaves the snapshot byte for byte what it was, which the pin reads as no
-- edit. Deleting and re-inserting would give every row a new id and turn each
-- untouched Save into an edit. A book item already on the entry is matched by
-- its item and keeps the label it was logged with; only an item the save adds
-- takes the item's name as it stands now, so the history reads the same after
-- a rename.
--
-- `p_entry_id` null creates the entry; otherwise it edits that entry of that
-- book, and a removed or foreign entry raises TT404. `p_items` must name at
-- least one item: an entry has to say what was done. Returns the entry's id.

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

-- A rider calls it; nobody else needs to. The service role has no auth.uid()
-- and the pin would refuse its insert without a logged_by, so it is not granted
-- - and it is revoked by name, because the hosted project's default privileges
-- hand execute on every new public function to service_role (20260719001100
-- reaches it through the schema-wide grant), which the hand-paste's verify
-- query found still true after a revoke naming only public, anon and
-- authenticated (2026-10-14). The local stack does not reproduce that default.
revoke all on function public.save_service_entry(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_service_entry(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;
