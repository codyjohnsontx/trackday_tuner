import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import { signInWith } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { EMPTY_SUSPENSION, EMPTY_TIRES } from '@/tests/e2e/helpers/session-fixtures';
import {
  createThrowawayRider,
  deleteThrowawayRider,
  type ThrowawayRider,
} from '@/tests/e2e/helpers/throwaway-rider';
import type { Database } from '@/types/supabase';

/**
 * A rider logs lap times and then reads them back without opening the editor.
 *
 * Before this the session page printed "3 included laps" and nothing else, and
 * the dashboard and sessions list rows carried no lap data at all. The laps are
 * saved through `replace_session_laps` as the rider, because that is what writes
 * the `telemetry_summaries` row the list rows read their headline from.
 */

const TRACK_NAME = 'PW Lap Visibility Circuit';
const LAPS = [
  { lap_number: 1, lap_time_ms: 102_350, included: true },
  { lap_number: 2, lap_time_ms: 101_700, included: true },
  { lap_number: 3, lap_time_ms: 101_920, included: true },
  { lap_number: 4, lap_time_ms: 130_000, included: false },
];
const HEADLINE = 'Best 1:41.700 · 3 laps';

test.describe('lap times outside the editor', () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(!hasServiceRole(), 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'NEXT_PUBLIC_SUPABASE_ANON_KEY is required to save laps as the rider',
  );

  let rider: ThrowawayRider | null = null;
  let sessionId = '';

  test.beforeEach(async () => {
    rider = await createThrowawayRider('lap-visibility');
    const admin = createTestAdminClient();

    const { data: vehicle, error: vehicleError } = await admin
      .from('vehicles')
      .insert({ user_id: rider.id, nickname: 'Lap View R6', type: 'motorcycle' })
      .select('id')
      .single();
    expect(vehicleError, vehicleError?.message).toBeNull();

    const { data: session, error: sessionError } = await admin
      .from('sessions')
      .insert({
        user_id: rider.id,
        vehicle_id: vehicle!.id,
        track_name: TRACK_NAME,
        date: '2019-05-11',
        conditions: 'sunny' as const,
        tires: EMPTY_TIRES,
        suspension: EMPTY_SUSPENSION,
      })
      .select('id')
      .single();
    expect(sessionError, sessionError?.message).toBeNull();
    sessionId = session!.id;

    const client = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: signInError } = await client.auth.signInWithPassword({
      email: rider.email,
      password: rider.password,
    });
    expect(signInError, signInError?.message).toBeNull();
    const { error: lapError } = await client.rpc('replace_session_laps', {
      p_user_id: rider.id,
      p_session_id: sessionId,
      p_laps: LAPS,
      p_expected_laps: [],
    });
    expect(lapError, lapError?.message).toBeNull();
  });

  test.afterEach(async () => {
    await deleteThrowawayRider(rider);
    rider = null;
  });

  test('the session page shows the numbers and every lap', async ({ page }) => {
    await signInWith(page, rider!.email, rider!.password);
    await page.goto(`/sessions/${sessionId}`);

    await expect(page.getByText('3 included laps · 1 not counted')).toBeVisible();
    // The Best cell; the same time also sits in the lap list, still closed here.
    await expect(page.getByText('1:41.700', { exact: true }).first()).toBeVisible();

    await page.getByText('Show every lap (4)').click();
    for (const time of ['1:42.350', '1:41.920', '2:10.000']) {
      await expect(page.getByText(time, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('Not counted', { exact: true })).toBeVisible();
  });

  test('the dashboard and sessions list rows carry the lap headline', async ({ page }) => {
    await signInWith(page, rider!.email, rider!.password);

    await expect(page.locator('a[href^="/sessions/"]').filter({ hasText: TRACK_NAME })).toContainText(HEADLINE);

    await page.goto('/sessions');
    await expect(page.getByText(HEADLINE)).toBeVisible();
  });
});
