import { test, expect, type Page } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';

/**
 * The core loop on the shape of data riders actually produce: several sessions on
 * one track day, Start Time left blank because it is optional and nobody stops to
 * fill it between runs.
 *
 * This used to fail silently. All three previous-session lookups filtered with a raw
 * `start_time.lt.<t>` predicate, and `NULL < '23:59:59'` is NULL rather than true, so
 * an earlier session with no start time was invisible: the compare panel claimed no
 * earlier session existed and `session_changes` never got a row. A unit test over the
 * ordering helpers would not have caught it — the helpers were always right, the raw
 * queries disagreed with them — so this asserts the rendered panel and the persisted
 * row, end to end.
 */

// Far enough from real logging that the two sessions created here are the only rows
// the previous-session lookup can choose between.
const SESSION_DATE = '2019-03-14';
const TRACK_NAME = 'PW Same-Day Track';
const FIRST_FRONT_PRESSURE = '33';
const SECOND_FRONT_PRESSURE = '35';

function formattedSessionDate(): string {
  return new Date(`${SESSION_DATE}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

async function ensureVehicleExists(page: Page) {
  await page.goto('/sessions/new');
  // /sessions/new redirects to /garage/new when the account has no vehicle.
  if (!/\/garage\/new/.test(page.url())) return;

  await page.getByLabel('Nickname', { exact: true }).fill(`PW Vehicle ${Date.now()}`);
  await page.getByRole('button', { name: 'Add Vehicle' }).click();
  await expect(page).toHaveURL(/\/garage$/);
  await page.goto('/sessions/new');
}

/** Logs one session with Start Time deliberately left blank. Returns its id. */
async function logSessionWithoutStartTime(
  page: Page,
  { sessionNumber, frontPressure }: { sessionNumber: string; frontPressure: string },
): Promise<string> {
  await page.goto('/sessions/new');
  await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible();

  await page.getByLabel('Track', { exact: true }).fill(TRACK_NAME);
  await page.getByLabel('Date', { exact: true }).fill(SESSION_DATE);
  await page.getByLabel('Session Number (optional)').fill(sessionNumber);
  await page.getByLabel('Front Pressure', { exact: true }).fill(frontPressure);

  // The whole point of the test: Start Time stays empty.
  await expect(page.getByLabel('Start Time', { exact: true })).toHaveValue('');

  await page.getByRole('button', { name: 'Save Session' }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/);

  return page.url().split('/').pop() as string;
}

test.describe('same-day sessions logged without a start time', () => {
  test.skip(!hasE2EAuth(), 'E2E_EMAIL and E2E_PASSWORD env vars are required');
  test.skip(
    !hasServiceRole(),
    'SUPABASE_SERVICE_ROLE_KEY is required to assert the session_changes row',
  );

  const createdSessionIds: string[] = [];

  test.afterEach(async () => {
    if (createdSessionIds.length === 0) return;
    // session_changes cascades on session_id, so this clears both tables.
    await createTestAdminClient().from('sessions').delete().in('id', createdSessionIds);
    createdSessionIds.length = 0;
  });

  test('compares against the earlier session and records the change', async ({ page }) => {
    await signIn(page);
    await ensureVehicleExists(page);

    const firstSessionId = await logSessionWithoutStartTime(page, {
      sessionNumber: '1',
      frontPressure: FIRST_FRONT_PRESSURE,
    });
    createdSessionIds.push(firstSessionId);

    const secondSessionId = await logSessionWithoutStartTime(page, {
      sessionNumber: '2',
      frontPressure: SECOND_FRONT_PRESSURE,
    });
    createdSessionIds.push(secondSessionId);

    const admin = createTestAdminClient();

    // Both rows really do have a null start_time — otherwise this test would be
    // exercising the ordinary timed path and covering nothing.
    const { data: sessionRows } = await admin
      .from('sessions')
      .select('id, start_time')
      .in('id', [firstSessionId, secondSessionId]);
    expect(sessionRows).toHaveLength(2);
    for (const row of sessionRows ?? []) {
      expect(row.start_time).toBeNull();
    }

    // Read path: the compare panel names the earlier session and shows the delta.
    await page.goto(`/sessions/${secondSessionId}`);
    await expect(page.getByText(`Compared against ${formattedSessionDate()}`)).toBeVisible();
    await expect(page.getByText('No earlier session found for this vehicle.')).toHaveCount(0);

    const frontPressureRow = page
      .locator('li')
      .filter({ hasText: 'Tires: Front Pressure' })
      .first();
    await expect(frontPressureRow).toContainText(FIRST_FRONT_PRESSURE);
    await expect(frontPressureRow).toContainText(SECOND_FRONT_PRESSURE);

    // Write path: creating the second session recorded a change against the first.
    const { data: changeRows } = await admin
      .from('session_changes')
      .select('*')
      .eq('session_id', secondSessionId)
      .eq('reference_kind', 'previous');

    expect(changeRows).toHaveLength(1);
    expect(changeRows?.[0].reference_session_id).toBe(firstSessionId);
    expect(changeRows?.[0].changes).toContainEqual(
      expect.objectContaining({
        group: 'Tires',
        label: 'Front pressure',
        from: FIRST_FRONT_PRESSURE,
        to: SECOND_FRONT_PRESSURE,
      }),
    );
  });
});
