import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';

/**
 * A circuit typed into the Track field used to store `track_id` null forever, so
 * a rider whose home track is not one of the seeded ones logged a season the
 * Tracks screen said did not exist - and every retype with different capitals
 * started a second history for the same place.
 *
 * The mocked action tests cover the branches; this covers the part they cannot,
 * which is that a name typed in the real form reaches a real row under the
 * tracks RLS insert policy.
 */

const SESSION_DATE = '2019-06-08';
// One per-run identifier, spelled two ways. A fixed name would let a stale row
// from an earlier run satisfy the "reuses it" assertion without this run ever
// creating a track, which is the half of the test that matters.
const RUN_ID = `${process.env.TEST_WORKER_INDEX ?? '0'}${Date.now()}`;
const TYPED_NAME = `PW Harris Hill Raceway ${RUN_ID}`;
const RETYPED_NAME = `pw harris  hill RACEWAY  ${RUN_ID}`;

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

async function logSession(page: Page, vehicleId: string, trackName: string): Promise<string> {
  await page.goto('/sessions/new');
  await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible();

  const vehicleSelect = page.getByLabel('Vehicle', { exact: true });
  await expect(async () => {
    await vehicleSelect.selectOption(vehicleId);
    await expect(vehicleSelect).toHaveValue(vehicleId);
  }).toPass({ timeout: 10_000 });

  const trackField = page.getByLabel('Track', { exact: true });
  await expect(async () => {
    await trackField.fill(trackName);
    await expect(trackField).toHaveValue(trackName);
  }).toPass({ timeout: 10_000 });

  await page.getByLabel('Date', { exact: true }).fill(SESSION_DATE);
  await page.getByRole('group', { name: 'Weather' }).getByRole('button', { name: 'Sunny' }).click();

  await page.getByRole('button', { name: 'Save Session' }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  return page.url().split('/').pop() as string;
}

test.describe('a track name the rider types', () => {
  test.describe.configure({ timeout: 120_000 });

  test.skip(!hasE2EAuth(), 'E2E_EMAIL and E2E_PASSWORD env vars are required');
  test.skip(!hasServiceRole(), 'SUPABASE_SERVICE_ROLE_KEY is required to assert the track row');

  const createdSessionIds: string[] = [];
  const createdTrackIds: string[] = [];
  let createdVehicleId: string | null = null;

  test.afterEach(async () => {
    const admin = createTestAdminClient();

    if (createdSessionIds.length > 0) {
      await admin.from('sessions').delete().in('id', createdSessionIds);
      createdSessionIds.length = 0;
    }
    if (createdTrackIds.length > 0) {
      await admin.from('tracks').delete().in('id', createdTrackIds);
      createdTrackIds.length = 0;
    }
    if (createdVehicleId) {
      await admin.from('vehicles').delete().eq('id', createdVehicleId);
      createdVehicleId = null;
    }
  });

  test('becomes a track row, and a retype with different capitals reuses it', async ({
    page,
  }, testInfo: TestInfo) => {
    await signIn(page);

    const vehicleId = await createRunVehicle(
      page,
      `PW Track Autosave ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`,
    );
    createdVehicleId = vehicleId;

    const admin = createTestAdminClient();

    const firstSessionId = await logSession(page, vehicleId, TYPED_NAME);
    createdSessionIds.push(firstSessionId);

    const { data: first } = await admin
      .from('sessions')
      .select('track_id, track_name')
      .eq('id', firstSessionId)
      .single();

    expect(first?.track_id).toBeTruthy();
    expect(first?.track_name).toBe(TYPED_NAME);
    createdTrackIds.push(first!.track_id as string);

    const { data: track } = await admin
      .from('tracks')
      .select('name, is_seeded, created_by')
      .eq('id', first!.track_id as string)
      .single();

    expect(track?.name).toBe(TYPED_NAME);
    expect(track?.is_seeded).toBe(false);
    expect(track?.created_by).toBeTruthy();

    // The same circuit, retyped the way a rider actually retypes it.
    const secondSessionId = await logSession(page, vehicleId, RETYPED_NAME);
    createdSessionIds.push(secondSessionId);

    const { data: second } = await admin
      .from('sessions')
      .select('track_id, track_name')
      .eq('id', secondSessionId)
      .single();

    expect(second?.track_id).toBe(first?.track_id);
    expect(second?.track_name).toBe(TYPED_NAME);

    // One circuit, not two.
    const { data: tracks } = await admin
      .from('tracks')
      .select('id')
      .eq('created_by', track!.created_by as string)
      // Scoped to this run's identifier: '%Harris Hill%' would also count rows
      // another device project created at the same moment.
      .ilike('name', `%${RUN_ID}%`);
    expect(tracks).toHaveLength(1);
  });
});
