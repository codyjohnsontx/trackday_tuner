import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  createTestAdminClient,
  findUserIdByEmail,
  hasServiceRole,
} from '@/tests/e2e/helpers/supabase';
import type { Database } from '@/types/supabase';

// The walk that tests/unit/storage-bucket-provisioning.test.ts says it cannot do.
//
// That guard reads supabase/config.toml and the migrations as text: it proves a
// `[storage.buckets.vehicle-photos]` block is declared public and that a
// migration writes owner-scoped select, insert and update policies on
// storage.objects for it. It cannot prove the CLI seeds the bucket, that the storage API honours the
// policies, or that the public URL the form stores is one the card can fetch.
// This is that check, driven the way a rider drives it: the ordinary form, a
// photo, then the row, the object and the URL.
//
// It ends on the assertion the bug was actually reported through. A database
// built fresh from this repository once had no bucket at all, so the form
// answered "Photo upload failed: Bucket not found" to every rider who attached a
// photo - and a stack anyone had worked against for a while never showed it,
// because the bucket had long since been created by hand.
//
// Signs up its own throwaway rider rather than using the shared E2E account. A
// new rider has no vehicles, so the free-plan vehicle cap in lib/plans.ts cannot
// refuse the save, and nothing here touches a row another project is using.
const PUBLIC_SIGNUP = (process.env.BETA_INVITE_ONLY ?? 'true') === 'false';
const BUCKET = 'vehicle-photos';

// A 1x1 transparent PNG. Bytes rather than a fixture file, so the spec carries
// the whole of what it uploads.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('adding a vehicle with a photo', () => {
  // Signup, the vehicle form and the garage each render on demand under a cold
  // `npm run dev`, and the explicit waits below total 50s against the 30s
  // default in playwright.config.ts. Same budget as signup-creates-profile.spec.ts.
  test.describe.configure({ timeout: 120_000 });

  test.skip(
    !hasServiceRole(),
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.',
  );
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'NEXT_PUBLIC_SUPABASE_ANON_KEY is required to upload as the rider and as nobody.',
  );
  test.skip(
    !PUBLIC_SIGNUP,
    'Requires BETA_INVITE_ONLY=false, so the form signs up a throwaway rider through GoTrue.',
  );

  let signupEmail: string | null = null;
  let signupUserId: string | null = null;
  // An object the service role plants under a folder that is nobody's, so the
  // rider's upsert onto it exercises the UPDATE policy rather than INSERT. It
  // lives outside the rider's folder, so the folder sweep below cannot find it
  // and it is removed by path.
  let foreignObjectPath: string | null = null;

  // A hook rather than a `finally`: Playwright abandons the body on timeout, and
  // the hook runs on its own budget afterwards. Objects are removed first because
  // storage.objects does not cascade from auth.users the way public.vehicles does,
  // and an orphaned object under a deleted rider's folder is what the next run
  // would read as "the upload leaked".
  test.afterEach(async () => {
    const email = signupEmail;
    const captured = signupUserId;
    const foreign = foreignObjectPath;
    signupEmail = null;
    signupUserId = null;
    foreignObjectPath = null;
    if (!email && !foreign) return;

    try {
      const admin = createTestAdminClient();
      if (foreign) await admin.storage.from(BUCKET).remove([foreign]);
      if (!email) return;
      const userId = captured ?? (await findUserIdByEmail(admin, email));
      if (!userId) return;
      const { data: objects } = await admin.storage.from(BUCKET).list(userId);
      if (objects && objects.length > 0) {
        await admin.storage.from(BUCKET).remove(objects.map((object) => `${userId}/${object.name}`));
      }
      await admin.auth.admin.deleteUser(userId);
    } catch {
      // Deliberately ignored: a failure to tidy up must not throw over the
      // assertion error underneath it.
    }
  });

  test('stores the photo in the vehicle-photos bucket and serves it publicly', async ({
    page,
  }, testInfo) => {
    const email = `vehicle-photo-${testInfo.project.name}-${randomUUID()}@example.com`;
    const password = `pw-${randomUUID()}`;
    signupEmail = email;
    const admin = createTestAdminClient();

    await page.goto('/login');
    await page.getByRole('button', { name: /^Sign Up$/ }).click();

    const loginForm = page.locator('form');
    const emailField = loginForm.getByLabel('Email');
    const passwordField = loginForm.getByLabel('Password');

    // Controlled inputs: anything typed before React hydrates is discarded.
    await expect(async () => {
      await emailField.fill(email);
      await passwordField.fill(password);
      await expect(emailField).toHaveValue(email);
      await expect(passwordField).toHaveValue(password);
    }).toPass({ timeout: 10_000 });

    const signupResponseUserId = page
      .waitForResponse(
        (response) =>
          response.url().includes('/auth/v1/signup') && response.request().method() === 'POST',
        { timeout: 20_000 },
      )
      .then(async (response) => {
        if (!response.ok()) return null;
        const body = (await response.json()) as { id?: string; user?: { id?: string } | null };
        return body.user?.id ?? body.id ?? null;
      })
      .catch(() => null);

    await loginForm.getByRole('button', { name: 'Create Account' }).click();
    signupUserId = await signupResponseUserId;
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    expect(signupUserId).not.toBeNull();
    const userId = signupUserId!;

    // A cold `npm run dev` compiles a route on its first visit, and compiling one
    // can make Fast Refresh reload every document it already serves - so the
    // first navigation to /garage/new in a dev server's life has been cut short
    // by a reload of the /dashboard it was leaving ("Navigation to /garage/new is
    // interrupted by another navigation to /dashboard"). A navigation that was
    // interrupted is repeated until it lands; a rider who saw the page flash
    // would do the same. The garage is visited first because the form returns
    // there, and that visit compiles it before the save is waiting on it.
    const visit = async (path: string, done: RegExp) => {
      await expect(async () => {
        await page.goto(path);
        await expect(page).toHaveURL(done);
      }).toPass({ timeout: 30_000 });
    };
    await visit('/garage', /\/garage$/);
    await visit('/garage/new', /\/garage\/new$/);
    const vehicleForm = page.locator('form');
    const nicknameField = vehicleForm.getByLabel('Nickname');
    const addVehicle = vehicleForm.getByRole('button', { name: 'Add Vehicle' });
    const nickname = `Photo bike ${testInfo.project.name}`;
    // Several device projects share that one server, so the form can take
    // longer than the fill loop's budget just to appear. Wait for it on the same
    // 20s the navigations below get, then retry the fill for hydration.
    await expect(nicknameField).toBeVisible({ timeout: 20_000 });
    // `toHaveValue` alone is not proof the fill survived hydration: the streamed
    // HTML keeps whatever was typed into it, so the check passes, and React then
    // resets the controlled input to its empty state on the next render - the
    // photo preview below - and the submit button stays disabled for good. That
    // is what iphone-safari did three runs out of three. Only React state can
    // enable the button, so its being enabled is the fill having been seen.
    //
    // The field is cleared before every attempt on purpose. When React hydrates
    // an input that already holds the text, it records that text as the value it
    // last saw, and an `input` event that leaves the value unchanged is dropped
    // before `onChange` - so refilling the same nickname would never be seen
    // however often it was retried. Clearing first makes the next fill a change.
    await expect(async () => {
      await nicknameField.clear();
      await nicknameField.fill(nickname);
      await expect(nicknameField).toHaveValue(nickname);
      await expect(addVehicle).toBeEnabled();
    }).toPass({ timeout: 10_000 });

    await vehicleForm.locator('input[type="file"]').setInputFiles({
      name: 'bike.png',
      mimeType: 'image/png',
      buffer: ONE_PIXEL_PNG,
    });
    // The form previews what it is about to upload, so this is the file having
    // been taken rather than silently dropped.
    await expect(vehicleForm.getByRole('img', { name: 'Vehicle preview' })).toBeVisible();

    await addVehicle.click();

    // The defect in one assertion. The form either lands on the garage or stays
    // put and surfaces the storage error verbatim, so wait for whichever comes
    // first and then read the message - reading it, rather than counting it, is
    // what puts the storage API's own words in the failure. On a database built
    // from the repository alone it read "Photo upload failed: Bucket not found".
    const uploadError = page.getByText(/Photo upload failed/);
    await expect
      .poll(async () => /\/garage$/.test(page.url()) || (await uploadError.count()) > 0, {
        timeout: 20_000,
      })
      .toBe(true);
    expect(await uploadError.allTextContents()).toEqual([]);
    await expect(page).toHaveURL(/\/garage$/);

    // What was persisted, read past the UI. The row has to point at the public
    // object endpoint of this bucket under the rider's own folder, because that
    // is the URL components/garage/vehicle-card.tsx renders.
    const { data: vehicle, error: vehicleError } = await admin
      .from('vehicles')
      .select('id, photo_url')
      .eq('user_id', userId)
      .eq('nickname', nickname)
      .maybeSingle();
    expect(vehicleError).toBeNull();
    expect(vehicle).not.toBeNull();
    const photoUrl = vehicle!.photo_url!;
    expect(photoUrl).toContain(`/storage/v1/object/public/${BUCKET}/${userId}/`);

    const { data: objects, error: listError } = await admin.storage.from(BUCKET).list(userId);
    expect(listError).toBeNull();
    expect(objects?.map((object) => object.name)).toEqual([expect.stringMatching(/_bike\.png$/)]);

    // A public bucket answers the stored URL to anyone, which is what lets the
    // card show the photo with no session at all.
    const publicFetch = await page.request.get(photoUrl);
    expect(publicFetch.status()).toBe(200);
    expect(publicFetch.headers()['content-type']).toMatch(/^image\//);
    expect((await publicFetch.body()).equals(ONE_PIXEL_PNG)).toBe(true);

    // The other half of "owners can manage their own photos": nobody else can
    // write into the bucket, and the rider cannot write outside their own folder.
    const anon = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: anonUpload } = await anon.storage
      .from(BUCKET)
      .upload(`${userId}/anon.png`, ONE_PIXEL_PNG, { contentType: 'image/png', upsert: true });
    expect(anonUpload).not.toBeNull();

    const rider = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: signInError } = await rider.auth.signInWithPassword({ email, password });
    expect(signInError).toBeNull();
    const { error: foreignFolderUpload } = await rider.storage
      .from(BUCKET)
      .upload(`${randomUUID()}/stray.png`, ONE_PIXEL_PNG, { contentType: 'image/png', upsert: true });
    expect(foreignFolderUpload).not.toBeNull();

    // That path was new, so `upsert: true` took the INSERT branch and the refusal
    // above says nothing about UPDATE. The form always upserts, so a rider who
    // can name a path that already exists would otherwise overwrite the photo
    // behind somebody else's vehicle card. Plant one as the service role, then
    // upsert onto it as the rider.
    foreignObjectPath = `${randomUUID()}/owned.png`;
    const { error: plantError } = await admin.storage
      .from(BUCKET)
      .upload(foreignObjectPath, ONE_PIXEL_PNG, { contentType: 'image/png' });
    expect(plantError).toBeNull();
    const { error: foreignObjectOverwrite } = await rider.storage
      .from(BUCKET)
      .upload(foreignObjectPath, Buffer.from('overwritten'), {
        contentType: 'image/png',
        upsert: true,
      });
    expect(foreignObjectOverwrite).not.toBeNull();
    const { data: untouched, error: untouchedError } = await admin.storage
      .from(BUCKET)
      .download(foreignObjectPath);
    expect(untouchedError).toBeNull();
    expect(Buffer.from(await untouched!.arrayBuffer()).equals(ONE_PIXEL_PNG)).toBe(true);

    // The bucket accepts what the form's `accept="image/*"` offers and nothing
    // else, so a picker that ignores the hint is refused rather than stored.
    const { error: notAnImage } = await rider.storage
      .from(BUCKET)
      .upload(`${userId}/notes.txt`, Buffer.from('not a photo'), {
        contentType: 'text/plain',
        upsert: true,
      });
    expect(notAnImage).not.toBeNull();

    // None of the refusals left anything behind.
    const { data: afterwards } = await admin.storage.from(BUCKET).list(userId);
    expect(afterwards?.length).toBe(1);
  });
});
