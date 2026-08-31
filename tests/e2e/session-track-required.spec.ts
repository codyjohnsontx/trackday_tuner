import { test, expect, type Page } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import {
  createTestAdminClient,
  findUserIdByEmail,
  hasServiceRole,
} from '@/tests/e2e/helpers/supabase';
import { runResourceId } from '@/tests/e2e/helpers/run-id';
import { EMPTY_SUSPENSION, EMPTY_TIRES } from '@/tests/e2e/helpers/session-fixtures';
import { MISSING_TRACK_MESSAGE } from '@/lib/session-track';

/**
 * The New Session form accepted a blank Track while Vehicle and Date were both
 * validated.
 *
 * Reproduced against a real account before the fix: leaving the field untouched
 * saved the session, `track_id` and `track_name` both came back null, and the
 * detail screen read "Unknown Track" with a dash where the circuit should be. A
 * session in that state is left out of the tracks list, the track's own history,
 * the best-lap board and every pace comparison, and nothing on screen says so.
 *
 * The mocked action tests in lib/actions/sessions.test.ts cover the branches.
 * This is the part they cannot reach: what the browser does when a rider taps
 * Save, which is where the field is actually filled in.
 */

const SESSION_DATE = '2019-06-11';

async function addVehicle(page: Page, nickname: string): Promise<string> {
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

/** Fills everything the save needs except the circuit. */
async function openNewSession(page: Page, vehicleId: string) {
  await page.goto('/sessions/new');
  await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible({ timeout: 20_000 });

  const vehicleSelect = page.getByLabel('Vehicle', { exact: true });
  await expect(async () => {
    await vehicleSelect.selectOption(vehicleId);
    await expect(vehicleSelect).toHaveValue(vehicleId);
  }).toPass({ timeout: 10_000 });

  await page.getByLabel('Date', { exact: true }).fill(SESSION_DATE);
  await page.getByRole('group', { name: 'Weather' }).getByRole('button', { name: 'Sunny' }).click();
}

test.describe('a session with no track', () => {
  test.describe.configure({ timeout: 120_000 });

  test.skip(!hasE2EAuth(), 'E2E_EMAIL and E2E_PASSWORD env vars are required');
  test.skip(!hasServiceRole(), 'SUPABASE_SERVICE_ROLE_KEY is required to assert nothing was stored');

  let createdVehicleId: string | null = null;

  test.afterEach(async () => {
    if (!createdVehicleId) return;
    // `sessions.vehicle_id` cascades, so removing the vehicle removes every
    // session this run logged against it, named or not.
    await createTestAdminClient().from('vehicles').delete().eq('id', createdVehicleId);
    createdVehicleId = null;
  });

  test('is refused by the form, and saves once the circuit is named', async ({ page }, testInfo) => {
    await signIn(page);
    const runId = runResourceId(testInfo);
    const admin = createTestAdminClient();

    createdVehicleId = await addVehicle(page, `PW Track Required ${runId}`);
    const vehicleId = createdVehicleId;
    const sessionsForVehicle = () =>
      admin.from('sessions').select('id, track_id, track_name').eq('vehicle_id', vehicleId);

    await openNewSession(page, vehicleId);

    // Leaving the field untouched used to save. The browser refuses it now, the
    // same way it already refuses a missing Date.
    const trackField = page.locator('#session-track');
    await page.getByRole('button', { name: 'Save Session' }).click();
    await expect(page).toHaveURL(/\/sessions\/new$/);
    await expect(trackField).toHaveJSProperty('validity.valueMissing', true);
    expect((await sessionsForVehicle()).data).toHaveLength(0);

    // `required` counts a space as filled, so the form's own check is what
    // refuses this one - and it says why, where the rider is looking.
    await expect(async () => {
      await trackField.fill('   ');
      await expect(trackField).toHaveValue('   ');
    }).toPass({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Save Session' }).click();

    // Scoped to the sticky bar rather than to the page: the refusal has to be
    // *in* the bar that carries the Save button, so it is on screen wherever in a
    // 3,000px form the rider tapped it. `getByRole('alert')` alone would also
    // match Next's route announcer.
    const alert = page.locator('form div.sticky').getByRole('alert');
    await expect(alert).toHaveText(MISSING_TRACK_MESSAGE, { timeout: 20_000 });
    await expect(alert).toBeInViewport();
    await expect(trackField).toBeFocused();
    expect((await sessionsForVehicle()).data).toHaveLength(0);

    // Name the circuit and the same save goes through.
    const trackName = `PW Required Circuit ${runId}`;
    await expect(async () => {
      await trackField.fill(trackName);
      await expect(trackField).toHaveValue(trackName);
    }).toPass({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Save Session' }).click();
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    const { data: saved } = await sessionsForVehicle();
    expect(saved).toHaveLength(1);
    expect(saved![0].track_name).toBe(trackName);

    // The track row this run created follows its vehicle out - the cascade only
    // reaches sessions.
    await admin.from('tracks').delete().eq('name', trackName);
  });

  test('says what a session logged before the field was required is missing', async ({
    page,
  }, testInfo) => {
    await signIn(page);
    const runId = runResourceId(testInfo);
    const admin = createTestAdminClient();

    const userId = await findUserIdByEmail(admin, process.env.E2E_EMAIL as string);
    expect(userId, 'the signed-in rider has to be findable to plant their legacy row').toBeTruthy();

    createdVehicleId = await addVehicle(page, `PW Legacy Trackless ${runId}`);

    // The row a rider actually has out there: saved before Track was required,
    // so it names no circuit at all. It can only be planted, because the form
    // refuses to make another one.
    const { data: legacy, error } = await admin
      .from('sessions')
      .insert({
        user_id: userId as string,
        vehicle_id: createdVehicleId,
        track_id: null,
        track_name: null,
        date: SESSION_DATE,
        conditions: 'sunny',
        tires: EMPTY_TIRES,
        suspension: EMPTY_SUSPENSION,
      })
      .select('id')
      .single();
    expect(error, error?.message).toBeNull();

    await page.goto(`/sessions/${legacy!.id}`);
    await expect(page.getByRole('heading', { name: 'Unknown Track' })).toBeVisible({
      timeout: 20_000,
    });
    // A dash in the Track row said none of this.
    await expect(page.getByText('No track recorded', { exact: false })).toBeVisible();
  });
});
