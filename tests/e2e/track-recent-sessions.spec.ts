import { test, expect } from '@playwright/test';
import { signInWith } from '@/tests/e2e/helpers/auth';
import { gotoPage } from '@/tests/e2e/helpers/navigation';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { EMPTY_SUSPENSION, EMPTY_TIRES } from '@/tests/e2e/helpers/session-fixtures';
import {
  createThrowawayRider,
  deleteThrowawayRider,
  type ThrowawayRider,
} from '@/tests/e2e/helpers/throwaway-rider';

/**
 * A rider opens one of their tracks and sees what they have logged there.
 *
 * "Recent Sessions" on the track page was a fixed paragraph promising history
 * "will appear here" - it queried nothing. A session belongs to the track when
 * it carries the track's id, or - for one saved before typed circuits were
 * linked - carries no id and names the same circuit.
 */

const TRACK_NAME = 'PW Home Circuit';

test.describe('recent sessions on the track page', () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(!hasServiceRole(), 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  let rider: ThrowawayRider | null = null;
  let trackId = '';
  let emptyTrackId = '';

  test.beforeEach(async () => {
    rider = await createThrowawayRider('track-sessions');
    const admin = createTestAdminClient();

    const { data: tracks, error: trackError } = await admin
      .from('tracks')
      .insert([
        { name: TRACK_NAME, created_by: rider.id, is_seeded: false },
        { name: 'PW Unvisited Circuit', created_by: rider.id, is_seeded: false },
      ])
      .select('id, name');
    expect(trackError, trackError?.message).toBeNull();
    trackId = tracks!.find((track) => track.name === TRACK_NAME)!.id;
    emptyTrackId = tracks!.find((track) => track.name !== TRACK_NAME)!.id;

    const { data: vehicle, error: vehicleError } = await admin
      .from('vehicles')
      .insert({ user_id: rider.id, nickname: 'Track Page R6', type: 'motorcycle' })
      .select('id')
      .single();
    expect(vehicleError, vehicleError?.message).toBeNull();

    const base = {
      user_id: rider.id,
      vehicle_id: vehicle!.id,
      conditions: 'sunny' as const,
      tires: EMPTY_TIRES,
      suspension: EMPTY_SUSPENSION,
    };
    const { error: sessionError } = await admin.from('sessions').insert([
      { ...base, track_id: trackId, track_name: TRACK_NAME, date: '2019-07-06', session_number: 1 },
      // Logged before typed circuits were linked: no id, the name spelled loosely.
      { ...base, track_id: null, track_name: 'pw home  circuit', date: '2019-08-03', session_number: 2 },
      { ...base, track_id: null, track_name: 'PW Somewhere Else', date: '2019-08-10', session_number: 3 },
    ]);
    expect(sessionError, sessionError?.message).toBeNull();
  });

  test.afterEach(async () => {
    await deleteThrowawayRider(rider);
    rider = null;
  });

  test('lists the sessions logged at this track, newest first, and nothing else', async ({ page }) => {
    await signInWith(page, rider!.email, rider!.password);
    await gotoPage(page, `/tracks/${trackId}`);

    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recent Sessions' }) });
    const rows = section.getByRole('link');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Aug 3, 2019');
    await expect(rows.nth(1)).toContainText('Jul 6, 2019');
    await expect(section).not.toContainText('PW Somewhere Else');
    await expect(section).not.toContainText('will appear here');

    await rows.nth(1).click();
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/);
  });

  test('says so when nothing has been logged at the track', async ({ page }) => {
    await signInWith(page, rider!.email, rider!.password);
    await gotoPage(page, `/tracks/${emptyTrackId}`);

    await expect(page.getByText('You have not logged a session at this track yet.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Log a Session' })).toBeVisible();
  });
});
