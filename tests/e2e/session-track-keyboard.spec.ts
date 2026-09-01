import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { runResourceId } from '@/tests/e2e/helpers/run-id';

/**
 * Picking a saved track without a mouse.
 *
 * Reproduced against a real account with two saved circuits: ArrowDown and Enter
 * on the Track field did nothing (selection was bound to `onMouseDown`), and Tab
 * out of it left `document.activeElement` on `<body>` - the list held focusable
 * buttons, and the input's blur handler unmounted them mid-Tab. So the one path
 * to the saved row a mouse rider takes in a tap was reachable by no key at all.
 *
 * tests/unit/track-picker-keyboard.test.ts locks the ARIA wiring off a static
 * render. Only a browser can press a key, so this is the walk.
 *
 * The circuit is named `<runId> Keyboard Circuit` and the rider types the runId
 * alone. That is what makes the final assertion mean something: the typed text
 * is not the track's name, so `resolveSessionTrack` would answer it by creating
 * a *second* row rather than finding this one. The stored `track_id` matching
 * the seeded track is therefore proof the keyboard did the picking.
 */

const SESSION_DATE = '2019-06-12';

async function seedTrack(page: Page, name: string): Promise<string> {
  await page.goto('/tracks/new');

  const field = page.getByLabel('Track name', { exact: true });
  await expect(async () => {
    await field.fill(name);
    await expect(field).toHaveValue(name);
  }).toPass({ timeout: 10_000 });

  await page.getByRole('button', { name: /add track/i }).click();
  await expect(page).toHaveURL(/\/tracks$/, { timeout: 20_000 });

  const { data, error } = await createTestAdminClient()
    .from('tracks')
    .select('id')
    .eq('name', name)
    .single();

  if (error || !data) {
    throw new Error(`Track "${name}" was not created: ${error?.message ?? 'no row returned'}`);
  }

  return data.id;
}

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

/** Narrows the suggestion list to this run's one circuit. */
async function typeRunQuery(page: Page, runId: string) {
  const trackField = page.locator('#session-track');
  const listbox = page.locator('#session-track-listbox');

  await expect(async () => {
    await trackField.fill(runId);
    await expect(listbox.getByRole('option')).toHaveCount(1);
  }).toPass({ timeout: 15_000 });

  return { trackField, listbox };
}

test.describe('picking a track with the keyboard', () => {
  test.describe.configure({ timeout: 120_000 });

  test.skip(!hasE2EAuth(), 'E2E_EMAIL and E2E_PASSWORD env vars are required');
  test.skip(
    !hasServiceRole(),
    'SUPABASE_SERVICE_ROLE_KEY is required to seed the track and read the stored row',
  );

  let createdVehicleId: string | null = null;
  let runId = '';

  test.afterEach(async () => {
    const admin = createTestAdminClient();
    if (createdVehicleId) {
      // Sessions cascade from the vehicle.
      await admin.from('vehicles').delete().eq('id', createdVehicleId);
      createdVehicleId = null;
    }
    if (runId) {
      // Sweeps the seeded circuit and any second row a regression would have the
      // save create beside it.
      await admin.from('tracks').delete().ilike('name', `%${runId}%`);
      runId = '';
    }
  });

  test('arrows to a saved circuit, picks it with Enter, and stores its track_id', async ({
    page,
  }, testInfo: TestInfo) => {
    await signIn(page);
    runId = runResourceId(testInfo);
    const admin = createTestAdminClient();

    const trackName = `${runId} Keyboard Circuit`;
    const trackId = await seedTrack(page, trackName);
    createdVehicleId = await addVehicle(page, `PW Track Keyboard ${runId}`);

    await page.goto('/sessions/new');
    await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible({ timeout: 20_000 });

    const vehicleSelect = page.getByLabel('Vehicle', { exact: true });
    await expect(async () => {
      await vehicleSelect.selectOption(createdVehicleId as string);
      await expect(vehicleSelect).toHaveValue(createdVehicleId as string);
    }).toPass({ timeout: 10_000 });

    const { trackField, listbox } = await typeRunQuery(page, runId);

    await expect(trackField).toHaveAttribute('aria-expanded', 'true');
    await trackField.press('ArrowDown');

    // Focus never leaves the input; the highlight travels through
    // aria-activedescendant, which is what a screen reader follows.
    await expect(trackField).toBeFocused();
    await expect(trackField).toHaveAttribute('aria-activedescendant', 'session-track-option-0');
    await expect(listbox.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');

    await trackField.press('Enter');
    // Enter picked the circuit, and did not also submit the form.
    await expect(trackField).toHaveValue(trackName);
    await expect(page).toHaveURL(/\/sessions\/new$/);
    await expect(listbox).toBeHidden();

    // Tab used to land on <body>. It reaches the next field now.
    await trackField.focus();
    await trackField.press('Tab');
    await expect(page.getByLabel('Date', { exact: true })).toBeFocused();

    await page.getByLabel('Date', { exact: true }).fill(SESSION_DATE);
    await page.getByRole('group', { name: 'Weather' }).getByRole('button', { name: 'Sunny' }).click();
    await page.getByRole('button', { name: 'Save Session' }).click();
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    const { data: saved } = await admin
      .from('sessions')
      .select('track_id, track_name')
      .eq('id', page.url().split('/').pop() as string)
      .single();

    // The point of the whole walk: a keyboard rider lands on the saved row
    // rather than on a name-only session beside it.
    expect(saved?.track_id).toBe(trackId);
    expect(saved?.track_name).toBe(trackName);

    // One circuit, not two.
    const { data: tracks } = await admin.from('tracks').select('id').ilike('name', `%${runId}%`);
    expect(tracks).toHaveLength(1);
  });

  test('closes the list on Escape and reopens it on ArrowDown', async ({
    page,
  }, testInfo: TestInfo) => {
    await signIn(page);
    runId = runResourceId(testInfo);

    await seedTrack(page, `${runId} Escape Circuit`);

    await page.goto('/sessions/new');
    await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible({ timeout: 20_000 });

    const { trackField, listbox } = await typeRunQuery(page, runId);

    await trackField.press('ArrowDown');
    await expect(trackField).toHaveAttribute('aria-activedescendant', 'session-track-option-0');

    await trackField.press('Escape');
    await expect(listbox).toBeHidden();
    await expect(trackField).toHaveAttribute('aria-expanded', 'false');
    // Escape dismisses the list; it does not throw away what was typed.
    await expect(trackField).toHaveValue(runId);

    await trackField.press('ArrowDown');
    await expect(listbox).toBeVisible();
    await expect(trackField).toHaveAttribute('aria-activedescendant', 'session-track-option-0');
  });
});
