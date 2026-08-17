import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { runResourceId } from '@/tests/e2e/helpers/run-id';

/**
 * Lap times a rider entered but never pressed "Add" on used to be dropped by the
 * save, silently. This is the shape that loses data - paste the laps off a
 * transponder printout, press Save Session, walk away - so it is asserted through
 * the browser and against the stored rows rather than against the parser, which
 * was never the part that was wrong.
 */

const SESSION_DATE = '2019-05-11';
// Set per test from runResourceId, which carries the device project as well as
// the worker - see tests/e2e/helpers/run-id.ts.
let trackName = '';
const PASTED_LAPS = ['1:42.350', '1:41.920', '1:41.700', '1:41.480'];
const QUICK_LAP = '1:40.900';

async function createRunVehicle(page: Page, nickname: string): Promise<string> {
  await page.goto('/garage/new');

  const nicknameField = page.getByLabel('Nickname', { exact: true });
  await expect(async () => {
    await nicknameField.fill(nickname);
    await expect(nicknameField).toHaveValue(nickname);
  }).toPass({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Add Vehicle' }).click();
  await expect(page).toHaveURL(/\/garage$/, { timeout: 20_000 });

  const { data, error } = await createTestAdminClient()
    .from('vehicles')
    .select('id')
    .eq('nickname', nickname)
    .single();

  if (error || !data) {
    throw new Error(`Vehicle "${nickname}" was not created: ${error?.message ?? 'no row returned'}`);
  }

  return data.id;
}

test.describe('lap times left in the editor entry boxes', () => {
  test.describe.configure({ timeout: 120_000 });

  test.skip(!hasE2EAuth(), 'E2E_EMAIL and E2E_PASSWORD env vars are required');
  test.skip(!hasServiceRole(), 'SUPABASE_SERVICE_ROLE_KEY is required to assert the stored laps');

  const createdSessionIds: string[] = [];
  let createdVehicleId: string | null = null;

  test.afterEach(async () => {
    const admin = createTestAdminClient();

    if (createdSessionIds.length > 0) {
      // session_laps cascades on session_id.
      await admin.from('sessions').delete().in('id', createdSessionIds);
      createdSessionIds.length = 0;
    }

    if (createdVehicleId) {
      await admin.from('vehicles').delete().eq('id', createdVehicleId);
      createdVehicleId = null;
    }
    // Saving a session creates the track row its name asks for, so the run has to
    // take that with it. The name is unique to this run, so this cannot reach a
    // track another device project is still using.
    if (trackName) {
      await admin.from('tracks').delete().eq('name', trackName);
      trackName = '';
    }
  });

  test('saves pasted and quick-add laps that were never added', async ({ page }, testInfo: TestInfo) => {
    await signIn(page);

    trackName = `PW Lap Paste Track ${runResourceId(testInfo)}`;
    const vehicleId = await createRunVehicle(page, `PW Lap Paste ${runResourceId(testInfo)}`);
    createdVehicleId = vehicleId;

    await page.goto('/sessions/new');
    await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible();

    const vehicleSelect = page.getByLabel('Vehicle', { exact: true });
    await expect(async () => {
      await vehicleSelect.selectOption(vehicleId);
      await expect(vehicleSelect).toHaveValue(vehicleId);
    }).toPass({ timeout: 10_000 });

    await page.getByLabel('Track', { exact: true }).fill(trackName);
    await page.getByLabel('Date', { exact: true }).fill(SESSION_DATE);
    await page.getByRole('group', { name: 'Weather' }).getByRole('button', { name: 'Sunny' }).click();

    await page.getByText('Paste several laps').click();
    const pasteBox = page.getByPlaceholder('1:42.350\n1:41.920\nLap 3: 1:41.700');
    await expect(async () => {
      await pasteBox.fill(PASTED_LAPS.join('\n'));
      await expect(pasteBox).toHaveValue(PASTED_LAPS.join('\n'));
    }).toPass({ timeout: 10_000 });

    const quickBox = page.getByPlaceholder('1:42.350', { exact: true });
    await expect(async () => {
      await quickBox.fill(QUICK_LAP);
      await expect(quickBox).toHaveValue(QUICK_LAP);
    }).toPass({ timeout: 10_000 });

    // Neither "Add" nor "Parse and add laps" is pressed: the rider goes straight
    // to Save, which is exactly how the laps used to disappear.
    await expect(page.getByText('No structured laps added.')).toBeVisible();

    await page.getByRole('button', { name: 'Save Session' }).click();
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    const sessionId = page.url().split('/').pop() as string;
    createdSessionIds.push(sessionId);

    const { data: laps } = await createTestAdminClient()
      .from('session_laps')
      .select('lap_number, lap_time_ms')
      .eq('session_id', sessionId)
      .order('lap_number');

    expect(laps?.map((lap) => lap.lap_time_ms)).toEqual([
      100_900, // the quick-add lap, folded in first
      102_350,
      101_920,
      101_700,
      101_480,
    ]);
  });
});
