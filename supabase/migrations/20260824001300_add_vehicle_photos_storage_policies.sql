-- Who may write into the vehicle-photos storage bucket.
--
-- The bucket itself is not created here. The Supabase CLI provisions buckets
-- from `[storage.buckets.*]` in supabase/config.toml - `supabase start` and
-- `supabase db reset` seed them locally, `supabase seed buckets --linked` seeds
-- the hosted project - and that file is where its name, its public flag and the
-- MIME types it accepts are declared. Policies on storage.objects are SQL, so
-- they live here beside every other policy in this repository. Neither half
-- depends on the other's order: a policy naming a bucket that does not exist yet
-- is an inert predicate, and a bucket with no policy refuses every write.
--
-- Until this migration and that block, a database built from the repository
-- alone had no bucket at all, and components/garage/vehicle-form.tsx answered
-- every photo with "Photo upload failed: Bucket not found". It was invisible on
-- any stack somebody had already fixed by hand in the dashboard.
--
-- The form uploads to `<user id>/<timestamp>_<file name>` with `upsert: true`
-- and stores `getPublicUrl` of the object on the vehicle row. So:
--   - reads need no policy: the bucket is public, and the public object
--     endpoint serves without consulting storage.objects. The select policy
--     below is what lets a rider list and read their own folder through the
--     authenticated API, which is also what the e2e cleanup relies on
--   - insert AND update are both required. An upsert onto an existing object
--     is an update, and an insert-only policy refuses it with an error that
--     reads like the bucket is fine
--   - every write is scoped to the first path segment being the caller's own
--     id, which is the folder the form writes. `storage.foldername(name)` is
--     the storage schema's own helper for exactly this, and `auth.uid()::text`
--     is how every own-row policy in these migrations identifies the rider
--   - `to authenticated` on each: `auth.uid()` is null for anon anyway, but
--     saying so keeps the intent readable, and anon holds no policy here
--
-- storage.objects already carries the platform's own grants to anon,
-- authenticated and service_role and has RLS enabled, so no grant is written.
-- The platform owns the table (supabase_storage_admin), and `postgres`, the
-- non-superuser role the CLI connects as, is still allowed to create policies
-- on it: that was checked in a rolled-back transaction against a local stack
-- before this file was written, and then by this file applying on a database
-- rebuilt from nothing. The hosted `postgres` role has the same shape, but only
-- `db push` there proves it.
--
-- tests/unit/storage-bucket-provisioning.test.ts fails if the insert or update
-- policy for this bucket goes missing or stops naming `auth.uid()`.
-- tests/e2e/vehicle-photo-upload.spec.ts is the walk: an upload through the
-- real form against a rebuilt stack, the stored URL fetched with no session,
-- and an anonymous client, a foreign-folder write and a non-image all refused.

create policy "vehicle-photos: select own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "vehicle-photos: insert own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "vehicle-photos: update own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "vehicle-photos: delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
