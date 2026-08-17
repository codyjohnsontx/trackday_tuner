import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';

/**
 * A default is not an answer.
 *
 * The New Session form used to open with Sunny and Scrubbed already pressed, and
 * the Session Outcome panel with Better already pressed, because each row seeded
 * its state with a value. A rider who scrolled past filed claims they never made
 * - into the weather badge on their history, the setup diff, the Race Engineer
 * prompt, and the learning record behind the recommendations.
 *
 * This asserts the rendered rows rather than the helpers behind them, because
 * the helpers were never the part that was wrong.
 */

const SESSION_DATE = '2019-04-02';
// Unique per run: all six device projects drive one shared E2E account, so a
// fixed name lets one project's cleanup delete a track another project's session
// still points at - and `sessions.track_id` is ON DELETE SET NULL, so that
// silently rewrites the other run's data.
const TRACK_NAME = `PW Unanswered Track ${process.env.TEST_WORKER_INDEX ?? '0'}-${Date.now()}`;

async function createRunVehicle(page: Page, nickname: string): Promise<string> {
  await page.goto('/garage/new');

  const nicknameField = page.getByLabel('Nickname', { exact: true });
  // Controlled input: a value typed into the streamed HTML before React hydrates
  // is thrown away. Retry until it sticks.
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

test.describe('answers the rider did not give', () => {
  test.describe.configure({ timeout: 120_000 });

  test.skip(!hasE2EAuth(), 'E2E_EMAIL and E2E_PASSWORD env vars are required');
  test.skip(!hasServiceRole(), 'SUPABASE_SERVICE_ROLE_KEY is required to assert the stored row');

  const createdSessionIds: string[] = [];
  let createdVehicleId: string | null = null;

  test.afterEach(async () => {
    const admin = createTestAdminClient();

    if (createdSessionIds.length > 0) {
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

  test('opens unanswered, refuses to save without weather, and stores only what was answered', async ({
    page,
  }, testInfo: TestInfo) => {
    await signIn(page);

    const vehicleId = await createRunVehicle(
      page,
      `PW Unanswered ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`,
    );
    createdVehicleId = vehicleId;

    await page.goto('/sessions/new');
    await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible();

    const weather = page.getByRole('group', { name: 'Weather' });
    const tireCondition = page.getByRole('group', { name: 'Tire condition' });

    // Nothing is pressed on a form the rider has not touched.
    for (const label of ['Sunny', 'Overcast', 'Rainy', 'Mixed']) {
      await expect(weather.getByRole('button', { name: label })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
    for (const label of ['New', 'Scrubbed', 'Used', 'Worn']) {
      await expect(tireCondition.getByRole('button', { name: label })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }

    const vehicleSelect = page.getByLabel('Vehicle', { exact: true });
    await expect(async () => {
      await vehicleSelect.selectOption(vehicleId);
      await expect(vehicleSelect).toHaveValue(vehicleId);
    }).toPass({ timeout: 10_000 });

    await page.getByLabel('Track', { exact: true }).fill(TRACK_NAME);
    await page.getByLabel('Date', { exact: true }).fill(SESSION_DATE);

    // Saving with the weather unanswered is refused rather than filled in.
    await page.getByRole('button', { name: 'Save Session' }).click();
    await expect(page.getByText(/Choose the weather for this session/)).toBeVisible();
    await expect(page).toHaveURL(/\/sessions\/new$/);

    await weather.getByRole('button', { name: 'Overcast' }).click();
    await expect(weather.getByRole('button', { name: 'Overcast' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByRole('button', { name: 'Save Session' }).click();
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    const sessionId = page.url().split('/').pop() as string;
    createdSessionIds.push(sessionId);

    const { data: row } = await createTestAdminClient()
      .from('sessions')
      .select('conditions, tires')
      .eq('id', sessionId)
      .single();

    expect(row?.conditions).toBe('overcast');
    // The tire condition row was never touched, so nothing was filed for it.
    expect(row?.tires.condition).toBeNull();
  });

  test('leaves the session verdict unpressed and the save disabled until it is given', async ({
    page,
  }, testInfo: TestInfo) => {
    await signIn(page);

    const vehicleId = await createRunVehicle(
      page,
      `PW Verdict ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`,
    );
    createdVehicleId = vehicleId;

    const admin = createTestAdminClient();
    // The outcome panel only renders once there is an earlier session to compare
    // against, so two are seeded directly - the panel is what is under test here,
    // not the form that reaches it.
    for (const [index, date] of ['2019-04-02', '2019-04-03'].entries()) {
      const { data, error } = await admin
        .from('sessions')
        .insert({
          user_id: (await admin.from('vehicles').select('user_id').eq('id', vehicleId).single())
            .data!.user_id,
          vehicle_id: vehicleId,
          track_name: TRACK_NAME,
          date,
          session_number: index + 1,
          conditions: 'overcast',
          tires: { front: { brand: '', compound: '', pressure: '32' }, rear: { brand: '', compound: '', pressure: '28' }, condition: null },
          suspension: {
            front: { preload: '5', compression: '12', rebound: '14', direction: 'out' },
            rear: { preload: '8', compression: '10', rebound: '16', direction: 'out' },
          },
        })
        .select('id')
        .single();

      if (error || !data) throw new Error(`Seed session failed: ${error?.message ?? 'no row'}`);
      createdSessionIds.push(data.id);
    }

    await page.goto(`/sessions/${createdSessionIds[1]}`);

    const outcome = page.getByRole('group', { name: 'Session outcome' });
    await expect(outcome).toBeVisible();
    for (const label of ['Better', 'Same', 'Worse', 'Unsure']) {
      await expect(outcome.getByRole('button', { name: label })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
    await expect(page.getByRole('button', { name: 'Save Outcome' })).toBeDisabled();

    await outcome.getByRole('button', { name: 'Worse' }).click();
    await expect(page.getByRole('button', { name: 'Save Outcome' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save Outcome' }).click();
    await expect(page.getByText(/Outcome saved/)).toBeVisible({ timeout: 20_000 });

    const { data: feedback } = await admin
      .from('session_feedback')
      .select('outcome')
      .eq('session_id', createdSessionIds[1])
      .single();

    expect(feedback?.outcome).toBe('worse');
  });
});
