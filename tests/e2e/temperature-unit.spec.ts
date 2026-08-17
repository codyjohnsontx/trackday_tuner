import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';

/**
 * The app only spoke Celsius, to a rider base whose tracks are all in Texas: an
 * ambient of 88 F could not be submitted at all, and 68 F went into the database
 * as 68 C - 154 F - which the prompts and the comparison flags then reasoned
 * about as a real reading.
 *
 * The whole point is what ends up in the column, so this drives the Settings
 * toggle and the form the way a rider would and then reads the stored row.
 */

const SESSION_DATE = '2019-07-19';
const TRACK_NAME = 'PW Fahrenheit Track';

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

test.describe('a rider who reads in Fahrenheit', () => {
  test.describe.configure({ timeout: 120_000 });

  test.skip(!hasE2EAuth(), 'E2E_EMAIL and E2E_PASSWORD env vars are required');
  test.skip(!hasServiceRole(), 'SUPABASE_SERVICE_ROLE_KEY is required to assert the stored row');

  const createdSessionIds: string[] = [];
  let createdVehicleId: string | null = null;

  test.afterEach(async () => {
    const admin = createTestAdminClient();

    if (createdSessionIds.length > 0) {
      // session_environment cascades on session_id.
      await admin.from('sessions').delete().in('id', createdSessionIds);
      createdSessionIds.length = 0;
    }
    if (createdVehicleId) {
      await admin.from('vehicles').delete().eq('id', createdVehicleId);
      createdVehicleId = null;
    }
  });

  test('enters and reads Fahrenheit while the database keeps Celsius', async ({
    page,
  }, testInfo: TestInfo) => {
    await signIn(page);

    const vehicleId = await createRunVehicle(
      page,
      `PW Fahrenheit ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`,
    );
    createdVehicleId = vehicleId;

    await page.goto('/settings');
    await page.getByRole('group', { name: 'Temperature unit' }).getByRole('button', { name: '°F' }).click();
    await expect(
      page.getByRole('group', { name: 'Temperature unit' }).getByRole('button', { name: '°F' }),
    ).toHaveAttribute('aria-pressed', 'true');

    await page.goto('/sessions/new');
    // The fields say what unit they are asking for.
    await expect(page.getByLabel(/^Ambient Temp \(°F\)$/)).toBeVisible();
    await expect(page.getByLabel(/^Track Temp \(°F\)$/)).toBeVisible();

    const vehicleSelect = page.getByLabel('Vehicle', { exact: true });
    await expect(async () => {
      await vehicleSelect.selectOption(vehicleId);
      await expect(vehicleSelect).toHaveValue(vehicleId);
    }).toPass({ timeout: 10_000 });

    await page.getByLabel('Track', { exact: true }).fill(TRACK_NAME);
    await page.getByLabel('Date', { exact: true }).fill(SESSION_DATE);
    await page.getByRole('group', { name: 'Weather' }).getByRole('button', { name: 'Sunny' }).click();

    // 88 used to be rejected outright for being above the Celsius maximum.
    await page.getByLabel(/^Ambient Temp \(°F\)$/).fill('68');
    await page.getByLabel(/^Track Temp \(°F\)$/).fill('88');

    await page.getByRole('button', { name: 'Save Session' }).click();
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    const sessionId = page.url().split('/').pop() as string;
    createdSessionIds.push(sessionId);

    const { data: environment } = await createTestAdminClient()
      .from('session_environment')
      .select('ambient_temperature_c, track_temperature_c')
      .eq('session_id', sessionId)
      .single();

    // Stored in Celsius, which is what every reader behind this expects.
    expect(environment?.ambient_temperature_c).toBe(20);
    expect(environment?.track_temperature_c).toBe(31.11);

    // And read back to the rider as the numbers they typed.
    await expect(page.getByText('68°F')).toBeVisible();
    await expect(page.getByText('88°F')).toBeVisible();
  });
});
