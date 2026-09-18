import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { runResourceId } from '@/tests/e2e/helpers/run-id';
import { addVehicle, seedTrack, typeRunQuery } from '@/tests/e2e/helpers/track-picker';

/**
 * Activating a suggestion row, however the activation arrives.
 *
 * Rows were bound to `onMouseDown` alone. A screen reader in browse mode (the
 * NVDA and JAWS virtual cursor) answers Enter on a row by invoking its default
 * action, which the browser delivers as a `click` with NO mousedown or mouseup
 * before it - so the row never activated and no saved circuit could be picked.
 * Reproduced here as `element.click()`, which is that same lone event.
 *
 * The row listens for `click` now, and only `click`. A real pointer ends its
 * mousedown/mouseup pair in one too, so the two paths arrive at a single handler
 * and neither can select twice - a property no browser can observe, so it is
 * locked in tests/unit/track-picker-keyboard.test.ts instead. The listbox still
 * refuses mousedown's default so focus never leaves the input, which is what
 * keeps the list open long enough for the pointer's click to land and what keeps
 * Tab working afterwards.
 *
 * tests/e2e/session-track-keyboard.spec.ts is the focus-mode walk (Arrow, Enter).
 * As there, the rider types the runId and not the circuit's name, so a stored
 * `track_id` equal to the seeded row is proof the activation did the picking.
 */

const SESSION_DATE = '2019-06-13';

/**
 * Records every value the Track field and its `aria-expanded` go on to take, so
 * a test can say the list closed on the circuit and stayed closed, rather than
 * only that it ended up that way.
 */
async function recordPickerChanges(trackField: Locator) {
  await trackField.evaluate((input: HTMLInputElement) => {
    const log: string[] = [];
    let last = '';
    const snapshot = () => {
      const entry = `${input.getAttribute('aria-expanded')}|${input.value}`;
      if (entry === last) return;
      last = entry;
      log.push(entry);
    };
    snapshot();
    new MutationObserver(snapshot).observe(input, { attributes: true });
    (window as unknown as { __trackPickerLog: string[] }).__trackPickerLog = log;
  });
}

function pickerChanges(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __trackPickerLog: string[] }).__trackPickerLog);
}

test.describe('activating a track suggestion', () => {
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
      await admin.from('tracks').delete().ilike('name', `%${runId}%`);
      runId = '';
    }
  });

  async function openPicker(page: Page, testInfo: TestInfo, circuit: string) {
    await signIn(page);
    runId = runResourceId(testInfo);

    const trackName = `${runId} ${circuit}`;
    const trackId = await seedTrack(page, trackName);
    createdVehicleId = await addVehicle(page, `PW Track Activation ${runId}`);

    await page.goto('/sessions/new');
    await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible({ timeout: 20_000 });

    const vehicleSelect = page.getByLabel('Vehicle', { exact: true });
    await expect(async () => {
      await vehicleSelect.selectOption(createdVehicleId as string);
      await expect(vehicleSelect).toHaveValue(createdVehicleId as string);
    }).toPass({ timeout: 10_000 });

    const picker = await typeRunQuery(page, runId);
    await recordPickerChanges(picker.trackField);

    return { ...picker, trackName, trackId };
  }

  test('a click with no mousedown before it picks the circuit and stores its track_id', async ({
    page,
  }, testInfo: TestInfo) => {
    const { trackField, listbox, trackName, trackId } = await openPicker(page, testInfo, 'Virtual Cursor Circuit');
    const admin = createTestAdminClient();

    // What a screen reader's virtual cursor sends for Enter on the row: the
    // element's default action, a lone click with no pointer sequence around it.
    await listbox.getByRole('option').first().evaluate((row: HTMLElement) => row.click());

    await expect(trackField).toHaveValue(trackName);
    await expect(listbox).toBeHidden();
    await expect(page).toHaveURL(/\/sessions\/new$/);
    // Open on the typed query, then closed on the circuit, with nothing between
    // and nothing after.
    expect(await pickerChanges(page)).toEqual([`true|${runId}`, `false|${trackName}`]);

    await page.getByLabel('Date', { exact: true }).fill(SESSION_DATE);
    await page.getByRole('group', { name: 'Weather' }).getByRole('button', { name: 'Sunny' }).click();
    await page.getByRole('button', { name: 'Save Session' }).click();
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    const { data: saved } = await admin
      .from('sessions')
      .select('track_id, track_name')
      .eq('id', page.url().split('/').pop() as string)
      .single();

    expect(saved?.track_id).toBe(trackId);
    expect(saved?.track_name).toBe(trackName);

    // One circuit, not a second row made from the typed text beside it.
    const { data: tracks } = await admin.from('tracks').select('id').ilike('name', `%${runId}%`);
    expect(tracks).toHaveLength(1);
  });

  test('a real pointer click picks the circuit once, keeps focus in the field, and Tab moves on', async ({
    page,
  }, testInfo: TestInfo) => {
    const { trackField, listbox, trackName } = await openPicker(page, testInfo, 'Pointer Circuit');

    // The full sequence: mousedown, mouseup, click.
    await listbox.getByRole('option').first().click();

    await expect(trackField).toHaveValue(trackName);
    await expect(listbox).toBeHidden();
    // Open, then closed on the circuit, and never reopened. This does NOT prove
    // a single handler: selecting twice is idempotent, and this spec passed
    // unchanged with the row bound to mousedown and click together. That
    // guarantee is held by tests/unit/track-picker-keyboard.test.ts.
    expect(await pickerChanges(page)).toEqual([`true|${runId}`, `false|${trackName}`]);

    // The listbox refuses mousedown's default, so the press never took focus out
    // of the input. That is what let the click land on a row that was still
    // there, and it is why Tab goes to the next field rather than to <body>.
    await expect(trackField).toBeFocused();
    await trackField.press('Tab');
    await expect(page.getByLabel('Date', { exact: true })).toBeFocused();
    // Leaving did not reopen the list or disturb the pick.
    await expect(listbox).toBeHidden();
    await expect(trackField).toHaveValue(trackName);
  });

  test('a touch tap picks the circuit and keeps focus in the field', async ({
    page,
    hasTouch,
  }, testInfo: TestInfo) => {
    test.skip(!hasTouch, 'only the phone and tablet projects have a touchscreen');

    const { trackField, listbox, trackName } = await openPicker(page, testInfo, 'Tap Circuit');

    // How most riders pick a circuit: the browser follows touchend with the
    // compatibility mousedown, mouseup and click, so this is the pointer path
    // arriving from a finger.
    await listbox.getByRole('option').first().tap();

    await expect(trackField).toHaveValue(trackName);
    await expect(listbox).toBeHidden();
    expect(await pickerChanges(page)).toEqual([`true|${runId}`, `false|${trackName}`]);
    await expect(trackField).toBeFocused();
  });
});
