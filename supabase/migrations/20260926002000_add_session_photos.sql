-- A photo on a session, and who may write it into the session-photos bucket.
--
-- Owner's decision D3 (2026-09-26, the mobile app plan): a session carries at
-- most one photo - a setup sheet, a tire, the bike - taken in the paddock by the
-- mobile app. It is stored exactly the way the bike photo is: a public bucket,
-- objects under the rider's own folder, and the object's public URL on the row.
--
-- `sessions.photo_url` holds `getPublicUrl` of the object and is null until a
-- photo is set. `authenticated` already holds table-level update on `sessions`
-- (20260719001100), and `sessions: update own` picks the row, so the rider can
-- set their own session's URL with no new grant. That is the same posture as
-- `vehicles.photo_url`: the column is rider-writable text, so a reader treats it
-- as a URL the rider supplied and nothing more.
--
-- The bucket itself is not created here, for the reason 20260824001300 gives:
-- the CLI provisions it from `[storage.buckets.session-photos]` in
-- supabase/config.toml. A hosted project with no CLI history gets both halves
-- from "Apply session photos by hand" in docs/beta-runbook.md.
--
-- The app writes `<user id>/<session id>.jpg` with `upsert: true`, so the
-- policies are the four vehicle-photos has, for the same reasons written out in
-- 20260824001300: select and update are required by the upsert itself, every
-- write is scoped to the first path segment being the caller's own id, and
-- delete lets a rider remove their own photo. Public reads need no policy.
--
-- Hot tire pressures (D2) need no migration: they are optional keys inside the
-- existing `sessions.tires` jsonb, `tires.front.hot_pressure` and
-- `tires.rear.hot_pressure` (`TireEnd` in types/supabase.ts).

alter table public.sessions add column if not exists photo_url text;

create policy "session-photos: select own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'session-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "session-photos: insert own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'session-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "session-photos: update own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'session-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'session-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "session-photos: delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'session-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
