import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { runResourceId } from '@/tests/e2e/helpers/run-id';

/**
 * A database built from this repository had no tracks at all, so every rider
 * typed their circuit out, and "Circuit of the Americas" one month and "COTA"
 * the next became two custom tracks and a season grouped under neither.
 * 20260916001600 seeds North America and gives each circuit the other names
 * it is known by.
 *
 * The action tests cover the branches against a mocked client. This covers what
 * they cannot: that the seeded rows, the alias table and the layout table are
 * readable by a real rider under RLS and the grants, and that the form - the
 * typeahead, the layout picker - reaches them.
 *
 * Seeded circuits are shared by every device project, so nothing here creates
 * or deletes one. Only the sessions, the vehicle and the one custom track this
 * run makes are cleaned up, each scoped to the run's identifier.
 */

const SESSION_DATE = '2019-07-13';
const COTA_SLUG = 'circuit-of-the-americas';
const CRESSON_SLUG = 'motorsport-ranch';

async function seededTrackId(slug: string): Promise<string | null> {
  const { data } = await createTestAdminClient().from('tracks').select('id').eq('slug', slug).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

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

async function openNewSession(page: Page, vehicleId: string) {
  await page.goto('/sessions/new');
  await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible();

  const vehicleSelect = page.getByLabel('Vehicle', { exact: true });
  await expect(async () => {
    await vehicleSelect.selectOption(vehicleId);
    await expect(vehicleSelect).toHaveValue(vehicleId);
  }).toPass({ timeout: 10_000 });
}

async function typeTrack(page: Page, trackName: string) {
  const trackField = page.getByLabel('Track', { exact: true });
  await expect(async () => {
    await trackField.fill(trackName);
    await expect(trackField).toHaveValue(trackName);
  }).toPass({ timeout: 10_000 });
}

async function saveSession(page: Page): Promise<string> {
  await page.getByLabel('Date', { exact: true }).fill(SESSION_DATE);
  await page.getByRole('group', { name: 'Weather' }).getByRole('button', { name: 'Sunny' }).click();
  await page.getByRole('button', { name: 'Save Session' }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return page.url().split('/').pop() as string;
}

async function storedTrack(sessionId: string) {
  const { data } = await createTestAdminClient()
    .from('sessions')
    .select('track_id, track_name, layout_id, layout_name')
    .eq('id', sessionId)
    .single();
  return data;
}

test.describe('a circuit the rider names', () => {
  test.describe.configure({ timeout: 120_000 });

  test.skip(!hasE2EAuth(), 'E2E_EMAIL and E2E_PASSWORD env vars are required');
  test.skip(!hasServiceRole(), 'SUPABASE_SERVICE_ROLE_KEY is required to assert the stored track');

  const createdSessionIds: string[] = [];
  const createdTrackIds: string[] = [];
  let createdVehicleId: string | null = null;

  test.beforeEach(async () => {
    test.skip(
      !(await seededTrackId(COTA_SLUG)),
      'the stack has no seeded tracks - apply 20260916001600_seed_north_america_tracks.sql',
    );
  });

  test.afterEach(async () => {
    const admin = createTestAdminClient();

    if (createdSessionIds.length > 0) {
      await admin.from('sessions').delete().in('id', createdSessionIds);
      createdSessionIds.length = 0;
    }
    if (createdTrackIds.length > 0) {
      // `is_seeded = false` so a mistake here can never take a shared circuit.
      await admin.from('tracks').delete().in('id', createdTrackIds).eq('is_seeded', false);
      createdTrackIds.length = 0;
    }
    if (createdVehicleId) {
      await admin.from('vehicles').delete().eq('id', createdVehicleId);
      createdVehicleId = null;
    }
  });

  test('lands two spellings of one circuit on the seeded track', async ({ page }, testInfo: TestInfo) => {
    await signIn(page);
    const runId = runResourceId(testInfo);
    const cotaId = await seededTrackId(COTA_SLUG);

    createdVehicleId = await createRunVehicle(page, `PW Seeded Track ${runId}`);

    // Typed out in full, never picked from the list.
    await openNewSession(page, createdVehicleId);
    await typeTrack(page, 'circuit of the americas');
    const first = await saveSession(page);
    createdSessionIds.push(first);

    // The typeahead offers the circuit for the name riders actually use...
    await openNewSession(page, createdVehicleId);
    await typeTrack(page, 'COTA');
    const option = page.getByRole('option', { name: /Circuit of the Americas/ });
    await expect(option).toBeVisible();
    // ...but the rider does not pick it. The save has to land there anyway.
    const second = await saveSession(page);
    createdSessionIds.push(second);

    for (const sessionId of [first, second]) {
      const row = await storedTrack(sessionId);
      expect(row?.track_id).toBe(cotaId);
      expect(row?.track_name).toBe('Circuit of the Americas');
      expect(row?.layout_id).toBeNull();
    }

    // COTA has one configuration, so there was nothing to choose.
    await openNewSession(page, createdVehicleId);
    await typeTrack(page, 'COTA');
    await expect(page.getByLabel(/^Layout/)).toHaveCount(0);
  });

  test('records the layout of a multi-layout circuit, and only when chosen', async ({ page }, testInfo: TestInfo) => {
    await signIn(page);
    const runId = runResourceId(testInfo);
    const cressonId = await seededTrackId(CRESSON_SLUG);

    createdVehicleId = await createRunVehicle(page, `PW Seeded Layout ${runId}`);

    await openNewSession(page, createdVehicleId);
    await typeTrack(page, 'MSR Cresson');
    const layoutSelect = page.getByLabel(/^Layout/);
    await expect(layoutSelect).toBeVisible();
    // Optional: it opens on "Not specified", not on a configuration.
    await expect(layoutSelect).toHaveValue('');
    await layoutSelect.selectOption({ label: '1.3-Mile' });
    const chosen = await saveSession(page);
    createdSessionIds.push(chosen);

    const chosenRow = await storedTrack(chosen);
    expect(chosenRow?.track_id).toBe(cressonId);
    expect(chosenRow?.track_name).toBe('MotorSport Ranch');
    expect(chosenRow?.layout_name).toBe('1.3-Mile');
    expect(chosenRow?.layout_id).toBeTruthy();

    // The session page says which configuration it was.
    await expect(page.getByText('1.3-Mile')).toBeVisible();

    // The same circuit with the question left alone saves with no layout.
    await openNewSession(page, createdVehicleId);
    await typeTrack(page, 'MotorSport Ranch');
    await expect(page.getByLabel(/^Layout/)).toBeVisible();
    const unchosen = await saveSession(page);
    createdSessionIds.push(unchosen);

    const unchosenRow = await storedTrack(unchosen);
    expect(unchosenRow?.track_id).toBe(cressonId);
    expect(unchosenRow?.layout_id).toBeNull();
    expect(unchosenRow?.layout_name).toBeNull();
  });

  test('still saves a circuit nobody seeded', async ({ page }, testInfo: TestInfo) => {
    await signIn(page);
    const runId = runResourceId(testInfo);
    const typedName = `PW Unseeded Raceway ${runId}`;

    createdVehicleId = await createRunVehicle(page, `PW Unseeded ${runId}`);

    await openNewSession(page, createdVehicleId);
    await typeTrack(page, typedName);
    const sessionId = await saveSession(page);
    createdSessionIds.push(sessionId);

    const row = await storedTrack(sessionId);
    expect(row?.track_name).toBe(typedName);
    expect(row?.track_id).toBeTruthy();
    createdTrackIds.push(row!.track_id as string);

    const { data: created } = await createTestAdminClient()
      .from('tracks')
      .select('is_seeded, slug')
      .eq('id', row!.track_id as string)
      .single();
    expect(created?.is_seeded).toBe(false);
    expect(created?.slug).toBeNull();
  });
});
