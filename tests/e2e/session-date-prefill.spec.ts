import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { runResourceId } from '@/tests/e2e/helpers/run-id';

/**
 * The Date field used to be seeded from `toISOString()`, which is UTC, so an
 * evening rider west of Greenwich opened the form already on tomorrow's date and
 * filed half a track day under the wrong day.
 *
 * The unit test around `todayLocalDate` pins the timezone, but the seeding is an
 * effect in the form and only exists on screen, so the browser is put where the
 * rider is - Texas, 23:30 - and asked what the field says. At that instant it is
 * already the next day in UTC, which is the only condition under which the two
 * implementations disagree.
 *
 * Start Time is seeded by the same effect, to the rider's clock at that instant
 * (decision 2026-10-04), so a session is timed to when it was logged unless the
 * rider changes it. A blank one sorts as midnight and put a session logged
 * without one ahead of every timed session that day. The form saves a draft as
 * soon as it opens, so the draft records whether the rider touched Start Time:
 * an untouched default is seeded again when the draft is restored, and a time
 * the rider set is kept.
 */

const SESSION_DRAFT_KEY = 'track_tuner:draft:session_form_new';
// 2026-08-17 23:30 in Texas is 2026-08-18 04:30 UTC.
const EVENING_IN_TEXAS = new Date('2026-08-18T04:30:00.000Z');
const RIDERS_DAY = '2026-08-17';
const UTC_DAY = '2026-08-18';
const RIDERS_CLOCK = '23:30';
// Twenty minutes on, the same evening in Texas.
const LATER_IN_TEXAS = new Date('2026-08-18T04:50:00.000Z');
const RIDERS_LATER_CLOCK = '23:50';

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

test.describe('a rider logging in the evening', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ timezoneId: 'America/Chicago' });

  test.skip(!hasE2EAuth(), 'E2E_EMAIL and E2E_PASSWORD env vars are required');
  test.skip(!hasServiceRole(), 'SUPABASE_SERVICE_ROLE_KEY is required to create the run vehicle');

  let createdVehicleId: string | null = null;
  let trackName = '';

  test.afterEach(async () => {
    const admin = createTestAdminClient();
    if (createdVehicleId) {
      // Sessions cascade with their vehicle.
      await admin.from('vehicles').delete().eq('id', createdVehicleId);
      createdVehicleId = null;
    }
    // Saving creates the track row its name asks for; the name is this run's own.
    if (trackName) {
      await admin.from('tracks').delete().eq('name', trackName);
      trackName = '';
    }
  });

  /** Opens a fresh form at the fixed evening instant, with no draft answering for it. */
  async function openFreshForm(page: Page) {
    // Fixed time only - the timers stay real so React can still hydrate.
    await page.clock.setFixedTime(EVENING_IN_TEXAS);
    await page.goto('/sessions/new');
    await page.evaluate((key) => localStorage.removeItem(key), SESSION_DRAFT_KEY);
    await page.reload();
  }

  /** Waits for the draft the form keeps on this device to hold `startTime`. */
  async function expectDraftStartTime(page: Page, startTime: string, startTimeEdited: boolean) {
    await expect
      .poll(() =>
        page.evaluate((key) => {
          const draft = JSON.parse(localStorage.getItem(key) ?? 'null');
          return draft ? { startTime: draft.startTime, startTimeEdited: draft.startTimeEdited } : null;
        }, SESSION_DRAFT_KEY),
      )
      .toEqual({ startTime, startTimeEdited });
  }

  /** Fills what a save requires, saves, and returns the stored start_time. */
  async function saveAndReadStartTime(page: Page, vehicleId: string): Promise<string | null> {
    const vehicleSelect = page.getByLabel('Vehicle', { exact: true });
    await expect(async () => {
      await vehicleSelect.selectOption(vehicleId);
      await expect(vehicleSelect).toHaveValue(vehicleId);
    }).toPass({ timeout: 10_000 });
    await page.getByLabel('Track', { exact: true }).fill(trackName);
    await page.getByRole('group', { name: 'Weather' }).getByRole('button', { name: 'Sunny' }).click();

    await page.getByRole('button', { name: 'Save Session' }).click();
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const sessionId = page.url().split('/').pop() as string;

    const { data, error } = await createTestAdminClient()
      .from('sessions')
      .select('start_time')
      .eq('id', sessionId)
      .single();
    if (error || !data) {
      throw new Error(`Session ${sessionId} was not read back: ${error?.message ?? 'no row returned'}`);
    }
    return data.start_time;
  }

  test('opens the form on their own calendar day, not the UTC one', async ({
    page,
  }, testInfo: TestInfo) => {
    await signIn(page);

    createdVehicleId = await createRunVehicle(
      page,
      `PW Evening ${runResourceId(testInfo)}`,
    );

    // Fixed time only - the timers stay real so React can still hydrate.
    await page.clock.setFixedTime(EVENING_IN_TEXAS);

    await page.goto('/sessions/new');
    // A draft from an earlier run carries its own date and would answer for the
    // seeding under test.
    await page.evaluate((key) => localStorage.removeItem(key), SESSION_DRAFT_KEY);
    await page.reload();

    // The two calendars genuinely disagree at this instant, so the assertion
    // below cannot pass by accident.
    expect(
      await page.evaluate(() => {
        // UTC getters rather than toISOString(), which this repository's own rule
        // forbids - including in the test that guards the rule.
        const now = new Date();
        return [
          String(now.getUTCFullYear()).padStart(4, '0'),
          String(now.getUTCMonth() + 1).padStart(2, '0'),
          String(now.getUTCDate()).padStart(2, '0'),
        ].join('-');
      }),
    ).toBe(UTC_DAY);

    const dateField = page.getByLabel('Date', { exact: true });
    await expect(dateField).toHaveValue(RIDERS_DAY, { timeout: 15_000 });
  });

  test('times the session to when it was logged unless the rider changes it', async ({
    page,
  }, testInfo: TestInfo) => {
    await signIn(page);
    trackName = `PW Start Time Track ${runResourceId(testInfo)}`;
    createdVehicleId = await createRunVehicle(page, `PW Start Time ${runResourceId(testInfo)}`);

    await openFreshForm(page);
    const startTimeField = page.getByLabel('Start Time', { exact: true });
    // The rider's clock, not UTC's 04:30.
    await expect(startTimeField).toHaveValue(RIDERS_CLOCK, { timeout: 15_000 });

    expect(await saveAndReadStartTime(page, createdVehicleId)).toBe(`${RIDERS_CLOCK}:00`);
  });

  test('keeps a start time the rider typed over the default', async ({ page }, testInfo: TestInfo) => {
    await signIn(page);
    trackName = `PW Start Time Edit Track ${runResourceId(testInfo)}`;
    createdVehicleId = await createRunVehicle(page, `PW Start Time Edit ${runResourceId(testInfo)}`);

    await openFreshForm(page);
    const startTimeField = page.getByLabel('Start Time', { exact: true });
    await expect(startTimeField).toHaveValue(RIDERS_CLOCK, { timeout: 15_000 });
    await startTimeField.fill('09:15');
    await expect(startTimeField).toHaveValue('09:15');

    expect(await saveAndReadStartTime(page, createdVehicleId)).toBe('09:15:00');
  });

  test('seeds the current time again when a draft holds the untouched default', async ({
    page,
  }, testInfo: TestInfo) => {
    await signIn(page);
    createdVehicleId = await createRunVehicle(page, `PW Start Time Draft ${runResourceId(testInfo)}`);

    await openFreshForm(page);
    const startTimeField = page.getByLabel('Start Time', { exact: true });
    await expect(startTimeField).toHaveValue(RIDERS_CLOCK, { timeout: 15_000 });
    await expectDraftStartTime(page, RIDERS_CLOCK, false);

    // The rider leaves without touching it and comes back later.
    await page.clock.setFixedTime(LATER_IN_TEXAS);
    await page.reload();

    await expect(page.getByText('Draft restored from this device.')).toBeVisible({ timeout: 15_000 });
    await expect(startTimeField).toHaveValue(RIDERS_LATER_CLOCK);
  });

  test('keeps a start time the rider set when the draft is restored', async ({
    page,
  }, testInfo: TestInfo) => {
    await signIn(page);
    createdVehicleId = await createRunVehicle(page, `PW Start Time Draft Edit ${runResourceId(testInfo)}`);

    await openFreshForm(page);
    const startTimeField = page.getByLabel('Start Time', { exact: true });
    await expect(startTimeField).toHaveValue(RIDERS_CLOCK, { timeout: 15_000 });
    await startTimeField.fill('09:15');
    await expectDraftStartTime(page, '09:15', true);

    await page.clock.setFixedTime(LATER_IN_TEXAS);
    await page.reload();

    await expect(page.getByText('Draft restored from this device.')).toBeVisible({ timeout: 15_000 });
    await expect(startTimeField).toHaveValue('09:15');
  });
});
