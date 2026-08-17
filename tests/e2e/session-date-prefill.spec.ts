import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';

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
 */

const SESSION_DRAFT_KEY = 'track_tuner:draft:session_form_new';
// 2026-08-17 23:30 in Texas is 2026-08-18 04:30 UTC.
const EVENING_IN_TEXAS = new Date('2026-08-18T04:30:00.000Z');
const RIDERS_DAY = '2026-08-17';
const UTC_DAY = '2026-08-18';

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

  test.afterEach(async () => {
    if (createdVehicleId) {
      await createTestAdminClient().from('vehicles').delete().eq('id', createdVehicleId);
      createdVehicleId = null;
    }
  });

  test('opens the form on their own calendar day, not the UTC one', async ({
    page,
  }, testInfo: TestInfo) => {
    await signIn(page);

    createdVehicleId = await createRunVehicle(
      page,
      `PW Evening ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`,
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
});
