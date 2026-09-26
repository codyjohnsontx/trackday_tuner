import { test, expect, type Page } from '@playwright/test';
import { signInWith } from '@/tests/e2e/helpers/auth';
import { gotoPage } from '@/tests/e2e/helpers/navigation';
import { createTestAdminClient, expectRows, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { EMPTY_SUSPENSION, EMPTY_TIRES } from '@/tests/e2e/helpers/session-fixtures';
import {
  createThrowawayRider,
  deleteThrowawayRider,
  type ThrowawayRider,
} from '@/tests/e2e/helpers/throwaway-rider';

/**
 * Deleting a session, or the bike it was logged on, takes its photo off the
 * public session-photos bucket too.
 *
 * The bucket is public, so a photo left behind keeps serving at its URL after
 * the rider was told the session is gone. The owner's rule (2026-09-26) is that
 * the photo goes first and the row only once Storage confirms; the unit suites
 * drive the refusal paths, which a live stack cannot be made to take on demand.
 * This walks the real hold and the real nickname gate, then asks Storage and the
 * public URL rather than trusting the page moving on.
 *
 * The photos are planted with the service client under the rider's own folder,
 * at the path the mobile app writes (`<user id>/<session id>.jpg`), and the row
 * stores `getPublicUrl` of it - the value the delete reads back.
 */

const NICKNAME = 'Photo Delete R6';
const BUCKET = 'session-photos';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function plantVehicle(riderId: string): Promise<string> {
  const { data, error } = await createTestAdminClient()
    .from('vehicles')
    .insert({ user_id: riderId, nickname: NICKNAME, type: 'motorcycle' })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  return data!.id;
}

/** A session on the bike, with a photo in the bucket when `withPhoto`; returns its id and photo URL. */
async function plantSession(
  riderId: string,
  vehicleId: string,
  date: string,
  withPhoto: boolean,
): Promise<{ id: string; photoUrl: string | null }> {
  const admin = createTestAdminClient();
  const { data, error } = await admin
    .from('sessions')
    .insert({
      user_id: riderId,
      vehicle_id: vehicleId,
      track_name: 'PW Photo Delete Circuit',
      date,
      conditions: 'sunny' as const,
      tires: EMPTY_TIRES,
      suspension: EMPTY_SUSPENSION,
    })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const id = data!.id;
  if (!withPhoto) return { id, photoUrl: null };

  const path = `${riderId}/${id}.jpg`;
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, PNG, { contentType: 'image/png', upsert: true });
  expect(uploadError, uploadError?.message).toBeNull();
  const photoUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const { error: updateError } = await admin.from('sessions').update({ photo_url: photoUrl }).eq('id', id);
  expect(updateError, updateError?.message).toBeNull();
  return { id, photoUrl };
}

/** Whether anyone holding the URL can still fetch the photo. */
async function serves(photoUrl: string): Promise<boolean> {
  const response = await fetch(photoUrl);
  return response.ok;
}

async function objectsInFolder(riderId: string): Promise<string[]> {
  const { data, error } = await createTestAdminClient().storage.from(BUCKET).list(riderId);
  expect(error, error?.message).toBeNull();
  return (data ?? []).map((object) => object.name);
}

async function hold(page: Page, name: string, ms: number) {
  const button = page.getByRole('button', { name });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeEnabled();
  await button.hover();
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test.describe('deleting what a session photo belongs to', () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(!hasServiceRole(), 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  let rider: ThrowawayRider | null = null;

  test.beforeEach(async () => {
    rider = await createThrowawayRider('session-photo-delete');
  });

  test.afterEach(async () => {
    if (rider) {
      const left = await objectsInFolder(rider.id);
      if (left.length > 0) {
        await createTestAdminClient().storage.from(BUCKET).remove(left.map((name) => `${rider!.id}/${name}`));
      }
    }
    await deleteThrowawayRider(rider);
    rider = null;
  });

  test('a held session delete takes its photo off the public bucket', async ({ page }) => {
    const vehicleId = await plantVehicle(rider!.id);
    const session = await plantSession(rider!.id, vehicleId, '2019-06-01', true);
    const kept = await plantSession(rider!.id, vehicleId, '2019-06-02', true);
    expect(await serves(session.photoUrl!)).toBe(true);

    await signInWith(page, rider!.email, rider!.password);
    await gotoPage(page, `/sessions/${session.id}`);
    await hold(page, 'Hold to delete session', 1_400);
    await expect(page).toHaveURL(/\/sessions$/, { timeout: 20_000 });

    const admin = createTestAdminClient();
    expect(expectRows(await admin.from('sessions').select('id').eq('id', session.id), 'session after delete')).toHaveLength(0);
    expect(await serves(session.photoUrl!)).toBe(false);
    // The rider's other session keeps its photo.
    expect(await serves(kept.photoUrl!)).toBe(true);
    expect(await objectsInFolder(rider!.id)).toEqual([`${kept.id}.jpg`]);
  });

  test('a bike delete takes the photo of every session on it off the public bucket', async ({ page }) => {
    const vehicleId = await plantVehicle(rider!.id);
    const sessions = [
      await plantSession(rider!.id, vehicleId, '2019-06-01', true),
      await plantSession(rider!.id, vehicleId, '2019-06-02', true),
      await plantSession(rider!.id, vehicleId, '2019-06-03', false),
    ];

    await signInWith(page, rider!.email, rider!.password);
    await gotoPage(page, `/garage/${vehicleId}/edit`);
    const field = page.getByLabel(`Type ${NICKNAME} to confirm`);
    await expect(async () => {
      await field.fill(NICKNAME);
      await expect(field).toHaveValue(NICKNAME);
    }).toPass({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Delete vehicle' }).click();
    await expect(page).toHaveURL(/\/garage$/, { timeout: 20_000 });

    const admin = createTestAdminClient();
    expect(expectRows(await admin.from('vehicles').select('id').eq('id', vehicleId), 'vehicle after delete')).toHaveLength(0);
    expect(
      expectRows(
        await admin.from('sessions').select('id').in('id', sessions.map((session) => session.id)),
        'sessions after delete',
      ),
    ).toHaveLength(0);
    for (const session of sessions) {
      if (session.photoUrl) expect(await serves(session.photoUrl)).toBe(false);
    }
    expect(await objectsInFolder(rider!.id)).toEqual([]);
  });
});
