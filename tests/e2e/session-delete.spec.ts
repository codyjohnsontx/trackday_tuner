import { test, expect, type Page } from '@playwright/test';
import { signInWith } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { EMPTY_SUSPENSION, EMPTY_TIRES } from '@/tests/e2e/helpers/session-fixtures';
import {
  createThrowawayRider,
  deleteThrowawayRider,
  type ThrowawayRider,
} from '@/tests/e2e/helpers/throwaway-rider';

/**
 * A rider mis-logs a session and takes it back off the books.
 *
 * `deleteSession` existed for months with no caller. This drives the real
 * press-and-hold rather than a click - `onConfirm` fires only from an
 * uninterrupted hold - and then reads the database, because the page moving on
 * proves nothing about the rows. The laps have to go with the session, which
 * only the foreign-key cascade does.
 */

const TRACK_NAME = 'PW Delete Circuit';
const LAPS = [
  { lap_number: 1, lap_time_ms: 102_350, included: true },
  { lap_number: 2, lap_time_ms: 101_920, included: true },
  { lap_number: 3, lap_time_ms: 101_700, included: true },
];

async function hold(page: Page, name: string, ms: number) {
  const button = page.getByRole('button', { name });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeEnabled();
  await button.hover();
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test.describe('deleting a mis-logged session', () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(!hasServiceRole(), 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  let rider: ThrowawayRider | null = null;
  let sessionId = '';

  test.beforeEach(async () => {
    rider = await createThrowawayRider('session-delete');
    const admin = createTestAdminClient();

    const { data: vehicle, error: vehicleError } = await admin
      .from('vehicles')
      .insert({ user_id: rider.id, nickname: 'Delete Test R6', type: 'motorcycle' })
      .select('id')
      .single();
    expect(vehicleError, vehicleError?.message).toBeNull();

    const { data: session, error: sessionError } = await admin
      .from('sessions')
      .insert({
        user_id: rider.id,
        vehicle_id: vehicle!.id,
        track_name: TRACK_NAME,
        date: '2019-04-21',
        conditions: 'sunny' as const,
        tires: EMPTY_TIRES,
        suspension: EMPTY_SUSPENSION,
      })
      .select('id')
      .single();
    expect(sessionError, sessionError?.message).toBeNull();
    sessionId = session!.id;

    const { error: lapError } = await admin
      .from('session_laps')
      .insert(LAPS.map((lap) => ({ ...lap, user_id: rider!.id, session_id: sessionId })));
    expect(lapError, lapError?.message).toBeNull();
  });

  test.afterEach(async () => {
    await deleteThrowawayRider(rider);
    rider = null;
  });

  test('names what goes with it, and a hold removes the session and its laps', async ({ page }) => {
    await signInWith(page, rider!.email, rider!.password);
    await page.goto(`/sessions/${sessionId}`);

    await expect(
      page.getByText(`Delete your ${TRACK_NAME} session from Sunday, April 21, 2019 on Delete Test R6.`),
    ).toBeVisible();
    await expect(page.getByText(/This also deletes the setup and notes you logged and 3 lap times\./)).toBeVisible();

    // A tap is not a confirmation: nothing may be deleted by it.
    await page.getByRole('button', { name: 'Hold to delete session' }).click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}$`));

    await hold(page, 'Hold to delete session', 1_400);
    await expect(page).toHaveURL(/\/sessions$/, { timeout: 20_000 });
    await expect(page.getByText(TRACK_NAME)).toHaveCount(0);

    const admin = createTestAdminClient();
    const { data: sessionRows } = await admin.from('sessions').select('id').eq('id', sessionId);
    expect(sessionRows ?? []).toHaveLength(0);
    const { data: lapRows } = await admin.from('session_laps').select('id').eq('session_id', sessionId);
    expect(lapRows ?? []).toHaveLength(0);
  });

  test('tells the rider when the session is already gone, and stays put', async ({ page }) => {
    await signInWith(page, rider!.email, rider!.password);
    await page.goto(`/sessions/${sessionId}`);
    await expect(page.getByRole('button', { name: 'Hold to delete session' })).toBeVisible();

    // Deleted out from under the open page - another tab, another device.
    await createTestAdminClient().from('sessions').delete().eq('id', sessionId);

    await hold(page, 'Hold to delete session', 1_400);
    await expect(page.getByRole('alert').filter({ hasText: 'This session could not be found.' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}$`));
  });
});
