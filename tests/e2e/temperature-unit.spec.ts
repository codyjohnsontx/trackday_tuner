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
// Unique per run: all six device projects drive one shared E2E account, so a
// fixed name lets one project's cleanup delete a track another project's session
// still points at - and `sessions.track_id` is ON DELETE SET NULL, so that
// silently rewrites the other run's data.
const TRACK_NAME = `PW Fahrenheit Track ${process.env.TEST_WORKER_INDEX ?? '0'}-${Date.now()}`;
const SESSION_DRAFT_KEY = 'track_tuner:draft:session_form_new';

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
    // Saving a session creates the track row its name asks for, so the run has to
    // take that with it. The name is unique to this run, so this cannot reach a
    // track another device project is still using.
    await admin.from('tracks').delete().eq('name', TRACK_NAME);
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
    // A draft left behind by another run would fill these fields before the test
    // does, and the reload below is about the draft this test writes.
    await page.evaluate((key) => localStorage.removeItem(key), SESSION_DRAFT_KEY);
    await page.reload();

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

    // The draft is written by an effect, so wait for it to carry what was typed
    // rather than reloading on a timer. Storing it was never the broken half.
    await expect
      .poll(
        () =>
          page.evaluate((key) => {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const draft = JSON.parse(raw) as {
              ambientTemperature?: string;
              trackTemperature?: string;
              temperatureUnit?: string;
            };
            return {
              ambientTemperature: draft.ambientTemperature,
              trackTemperature: draft.trackTemperature,
              temperatureUnit: draft.temperatureUnit,
            };
          }, SESSION_DRAFT_KEY),
        { timeout: 10_000 },
      )
      .toEqual({ ambientTemperature: '68', trackTemperature: '88', temperatureUnit: 'f' });

    // Coming back to the form restores that draft while the unit preference is
    // still arriving from storage, and the two together used to read the text a
    // second time: 68 came back as 154.4, the Fahrenheit of 68 Celsius.
    await page.reload();

    // Hydration has put the draft's date back, and the °F in the label is the
    // preference having settled - the reread landed on the render after it.
    await expect(page.getByLabel('Date', { exact: true })).toHaveValue(SESSION_DATE);
    await expect(page.getByLabel(/^Ambient Temp \(°F\)$/)).toBeVisible();
    await page.waitForTimeout(1_000);

    await expect(page.getByLabel(/^Ambient Temp \(°F\)$/)).toHaveValue('68');
    await expect(page.getByLabel(/^Track Temp \(°F\)$/)).toHaveValue('88');

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

  test('keeps the temperatures in a draft written before the unit preference existed', async ({
    page,
  }) => {
    await signIn(page);

    // Exactly what the shipped app stored before this change: Celsius text under
    // the old key names, and no unit recorded. Reading only the new keys left both
    // fields empty and the draft-saving effect then overwrote the rider's values,
    // so coming back to the form lost them for good.
    await page.goto('/sessions/new');
    await page.evaluate((key) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          trackQuery: 'PW Legacy Draft Track',
          trackId: null,
          date: '2019-07-19',
          startTime: '',
          sessionNumber: '',
          conditions: 'sunny',
          ambientTemperatureC: '24',
          trackTemperatureC: '36',
          humidityPercent: '55',
          notes: 'legacy draft',
          laps: [],
        }),
      );
    }, SESSION_DRAFT_KEY);
    await page.reload();

    // Hydration has run: the draft's own date is back on screen.
    await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2019-07-19');
    // Humidity proves the draft was restored at all, so an empty temperature below
    // is the temperatures being dropped rather than the draft being ignored.
    await expect(page.getByLabel(/^Humidity/)).toHaveValue('55');

    await expect(page.getByLabel(/^Ambient Temp/)).toHaveValue('24');
    await expect(page.getByLabel(/^Track Temp/)).toHaveValue('36');

    // Leave no draft behind for the other spec in this file.
    await page.evaluate((key) => window.localStorage.removeItem(key), SESSION_DRAFT_KEY);
  });
});
