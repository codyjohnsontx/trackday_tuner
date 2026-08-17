import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { runResourceId } from '@/tests/e2e/helpers/run-id';

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
// Set per test from runResourceId, which carries the device project as well as
// the worker - see tests/e2e/helpers/run-id.ts.
let trackName = '';
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

/**
 * A vehicle of this run's own, created and torn down here rather than borrowed from
 * the garage.
 *
 * All six Playwright projects drive the single shared E2E account, and `fullyParallel:
 * false` only serialises tests inside one file, so several of them log sessions at the
 * same moment. The previous-session lookup is scoped by `vehicle_id`, so a private
 * vehicle makes this run's two sessions the only rows it can choose between and keeps
 * one project's cleanup away from another project's data. Returns the vehicle id.
 */
async function createRunVehicle(page: Page, nickname: string): Promise<string> {
  await page.goto('/garage/new');

  const nicknameField = page.getByLabel('Nickname', { exact: true });
  // Controlled input: a value typed into the streamed HTML before React hydrates is
  // thrown away. Retry until it sticks.
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

/** Logs one session with Start Time deliberately left blank. Returns its id. */
async function logSessionWithoutStartTime(
  page: Page,
  {
    vehicleId,
    sessionNumber,
    frontPressure,
  }: { vehicleId: string; sessionNumber: string; frontPressure: string },
): Promise<string> {
  await page.goto('/sessions/new');
  await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible();

  // The form preselects a vehicle only when the account has exactly one, and this
  // account has as many as the concurrent projects have created, so pick explicitly.
  const vehicleSelect = page.getByLabel('Vehicle', { exact: true });
  await expect(async () => {
    await vehicleSelect.selectOption(vehicleId);
    await expect(vehicleSelect).toHaveValue(vehicleId);
  }).toPass({ timeout: 10_000 });

  await page.getByLabel('Track', { exact: true }).fill(trackName);
  await page.getByLabel('Date', { exact: true }).fill(SESSION_DATE);
  await page.getByLabel('Session Number (optional)').fill(sessionNumber);
  // Weather opens unanswered and the save refuses without it, so this session has
  // to say what the sky was doing. See lib/session-answers.ts.
  await page.getByRole('group', { name: 'Weather' }).getByRole('button', { name: 'Sunny' }).click();
  await page.getByLabel('Front Pressure', { exact: true }).fill(frontPressure);

  // The whole point of the test: Start Time stays empty.
  await expect(page.getByLabel('Start Time', { exact: true })).toHaveValue('');

  await page.getByRole('button', { name: 'Save Session' }).click();
  // Saving is a server action followed by a client navigation that waits on the new
  // session's RSC payload. The default 5s expectation is tight enough that two device
  // projects sharing one dev server trip it while the save itself is succeeding.
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  return page.url().split('/').pop() as string;
}

test.describe('same-day sessions logged without a start time', () => {
  // Signing in, adding a vehicle and logging two full sessions is several times the
  // work of the other smoke tests, and `npm run test:e2e` runs six device projects
  // against one dev server. At the shared 30s budget this test times out on nothing
  // worse than a busy machine.
  test.describe.configure({ timeout: 120_000 });

  test.skip(!hasE2EAuth(), 'E2E_EMAIL and E2E_PASSWORD env vars are required');
  test.skip(
    !hasServiceRole(),
    'SUPABASE_SERVICE_ROLE_KEY is required to assert the session_changes row',
  );

  const createdSessionIds: string[] = [];
  let createdVehicleId: string | null = null;

  test.afterEach(async () => {
    const admin = createTestAdminClient();

    if (createdSessionIds.length > 0) {
      // session_changes cascades on session_id, so this clears both tables.
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

  test('compares against the earlier session and records the change', async ({ page }, testInfo: TestInfo) => {
    await signIn(page);

    trackName = `PW Same-Day Track ${runResourceId(testInfo)}`;
    const vehicleId = await createRunVehicle(page, `PW Same-Day ${runResourceId(testInfo)}`);
    createdVehicleId = vehicleId;

    const firstSessionId = await logSessionWithoutStartTime(page, {
      vehicleId,
      sessionNumber: '1',
      frontPressure: FIRST_FRONT_PRESSURE,
    });
    createdSessionIds.push(firstSessionId);

    const secondSessionId = await logSessionWithoutStartTime(page, {
      vehicleId,
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
