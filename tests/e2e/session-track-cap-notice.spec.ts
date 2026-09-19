import { randomUUID } from 'node:crypto';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { EMPTY_SUSPENSION, EMPTY_TIRES } from '@/tests/e2e/helpers/session-fixtures';
import { getFreePlanLimit, getFreePlanLimitMessage, getFreePlanLimitTitle } from '@/lib/plans';

/**
 * A free rider already holding their three custom tracks types a circuit that is
 * none of them. `resolveSessionTrack` cannot add a fourth, so the session saves
 * with `track_id` null - which it always did. What it did not do was say so:
 * reproduced on a local stack, the form saved, the session page listed the name,
 * and nothing on either screen told the rider the circuit was not on their
 * tracks. The session page's notice fired only for a session with no name at
 * all.
 *
 * lib/session-track.test.ts locks the rule. This is the walk: what the form
 * shows before Save, what the saved row holds, what the session page shows after
 * - and that a session with no name still gets the notice it always did. Then the
 * two ways the form could still get it wrong: a Save that reaches the server
 * while the suggestion list is hiding the note, and a copied or restored track
 * whose id links fine but whose stored name has since been renamed.
 */

const FREE_TRACK_LIMIT = getFreePlanLimit('tracks');
const SESSION_DATE = '2019-06-15';

async function signInAs(page: Page, email: string, password: string) {
  await page.goto('/login');

  const form = page.locator('form');
  const emailField = form.getByLabel('Email');
  const passwordField = form.getByLabel('Password');

  // Controlled inputs: anything typed before React hydrates is discarded.
  await expect(async () => {
    await emailField.fill(email);
    await passwordField.fill(password);
    await expect(emailField).toHaveValue(email);
    await expect(passwordField).toHaveValue(password);
  }).toPass({ timeout: 10_000 });

  await form.getByRole('button', { name: /^Sign In$/ }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test.describe('a free rider at the track limit', () => {
  test.describe.configure({ timeout: 120_000 });

  test.skip(
    !hasServiceRole(),
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to make a rider at the limit',
  );

  // Its own throwaway rider, because the shared E2E account is on Pro by design
  // (see TESTING.md) and no free-plan cap can reach it.
  let riderId: string | null = null;

  /**
   * A throwaway free rider holding exactly the custom-track limit - one fewer and
   * a typed circuit becomes a track row. The saved names carry a per-run tag so
   * a seeded track on the stack cannot answer for them.
   */
  async function createRiderAtTrackLimit(testInfo: TestInfo) {
    const admin = createTestAdminClient();
    const tag = randomUUID().slice(0, 8);
    const email = `track-limit-${testInfo.project.name}-${randomUUID()}@example.com`;
    const password = `pw-${randomUUID()}`;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(createError, createError?.message).toBeNull();
    riderId = created.user!.id;

    const { data: vehicle, error: vehicleError } = await admin
      .from('vehicles')
      .insert({ user_id: riderId, nickname: 'Track limit bike', type: 'motorcycle' })
      .select('id')
      .single();
    expect(vehicleError, vehicleError?.message).toBeNull();

    const savedNames = [`PW ${tag} Thunderhill East`, `PW ${tag} Sonoma Raceway`, `PW ${tag} Laguna Seca`];
    expect(savedNames).toHaveLength(FREE_TRACK_LIMIT);
    const { data: tracks, error: tracksError } = await admin
      .from('tracks')
      .insert(savedNames.map((name) => ({ name, is_seeded: false, created_by: riderId as string })))
      .select('id, name');
    expect(tracksError, tracksError?.message).toBeNull();

    return { admin, tag, email, password, riderId: riderId as string, vehicleId: vehicle!.id, tracks: tracks! };
  }

  async function sessionCount(admin: ReturnType<typeof createTestAdminClient>, userId: string) {
    const { count } = await admin
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    return count ?? 0;
  }

  async function fillDateAndWeather(page: Page) {
    await page.getByLabel('Date', { exact: true }).fill(SESSION_DATE);
    await page.getByRole('group', { name: 'Weather' }).getByRole('button', { name: 'Sunny' }).click();
  }

  test.afterEach(async () => {
    if (!riderId) return;
    // Vehicles, tracks and sessions go with the user.
    await createTestAdminClient().auth.admin.deleteUser(riderId);
    riderId = null;
  });

  test('is told the circuit they typed is not on their tracks, before and after Save', async ({
    page,
  }, testInfo: TestInfo) => {
    const { admin, tag, email, password, riderId: userId, vehicleId } = await createRiderAtTrackLimit(testInfo);

    // A session planted with no name, the way sessions were logged before Track
    // was required, so the existing notice is checked on the same account.
    const { data: trackless, error: tracklessError } = await admin
      .from('sessions')
      .insert({
        user_id: userId,
        vehicle_id: vehicleId,
        track_name: null,
        date: SESSION_DATE,
        conditions: 'sunny',
        tires: EMPTY_TIRES,
        suspension: EMPTY_SUSPENSION,
      })
      .select('id')
      .single();
    expect(tracklessError, tracklessError?.message).toBeNull();

    await signInAs(page, email, password);

    // Matches no saved circuit even as a fragment, so no list ever covers the note.
    const typedName = `Thunderhill West ${randomUUID().slice(0, 8)}`;
    await page.goto('/sessions/new');
    await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible({ timeout: 20_000 });

    const vehicleSelect = page.getByLabel('Vehicle', { exact: true });
    await expect(async () => {
      await vehicleSelect.selectOption(vehicleId);
      await expect(vehicleSelect).toHaveValue(vehicleId);
    }).toPass({ timeout: 10_000 });

    const trackField = page.getByLabel('Track', { exact: true });
    await expect(async () => {
      await trackField.fill(typedName);
      await expect(trackField).toHaveValue(typedName);
    }).toPass({ timeout: 10_000 });

    // Before Save, under the field, and tied to it for a screen reader.
    const formNotice = page.locator('#session-track-limit');
    await expect(formNotice).toBeVisible();
    await expect(formNotice).toContainText(getFreePlanLimitTitle('tracks'));
    await expect(formNotice).toContainText(`"${typedName}" is not one of your saved tracks`);
    await expect(formNotice).toContainText(getFreePlanLimitMessage('tracks'));
    await expect(trackField).toHaveAttribute('aria-describedby', 'session-track-limit');

    // Retyping one of their saved circuits clears it: that one links.
    await trackField.fill(`pw ${tag}  THUNDERHILL east`);
    await page.keyboard.press('Escape');
    await expect(formNotice).toHaveCount(0);
    await trackField.fill(typedName);
    await expect(formNotice).toBeVisible();

    // The note was on screen the whole time, so the first Save goes through.
    await fillDateAndWeather(page);
    await page.getByRole('button', { name: 'Save Session' }).click();
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const sessionId = page.url().split('/').pop() as string;

    // The cap itself is unchanged: the session saved, by name only.
    const { data: saved } = await admin
      .from('sessions')
      .select('track_id, track_name')
      .eq('id', sessionId)
      .single();
    expect(saved?.track_id).toBeNull();
    expect(saved?.track_name).toBe(typedName);

    const detailNotice = page.getByRole('note').filter({ hasText: getFreePlanLimitTitle('tracks') });
    await expect(detailNotice).toBeVisible({ timeout: 20_000 });
    await expect(detailNotice).toContainText(`"${typedName}" is not one of your saved tracks`);
    await expect(detailNotice).toContainText(getFreePlanLimitMessage('tracks'));
    await expect(page.getByText('No track recorded')).toHaveCount(0);

    // The session with no name still reads as it did, and is not told about a cap.
    await page.goto(`/sessions/${trackless!.id}`);
    await expect(page.getByText('No track recorded')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('note').filter({ hasText: getFreePlanLimitTitle('tracks') })).toHaveCount(0);
  });

  test('is shown the note before a Save the suggestion list was hiding it from, by Enter or by tapping Save', async ({
    page,
  }, testInfo: TestInfo) => {
    const { admin, tag, email, password, riderId: userId } = await createRiderAtTrackLimit(testInfo);
    await signInAs(page, email, password);

    await page.goto('/sessions/new');
    await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible({ timeout: 20_000 });
    await fillDateAndWeather(page);

    const trackField = page.getByLabel('Track', { exact: true });
    const formNotice = page.locator('#session-track-limit');
    const listbox = page.getByRole('listbox', { name: 'Saved tracks' });

    // A new circuit whose name is a fragment of a saved one: the list stays open
    // on the saved circuit, so the note under the field is covered.
    const enterName = `PW ${tag} Thunderhill`;
    await expect(async () => {
      await trackField.fill(enterName);
      await expect(trackField).toHaveValue(enterName);
    }).toPass({ timeout: 10_000 });
    await expect(listbox).toBeVisible();
    await expect(formNotice).toHaveCount(0);

    // Enter with nothing highlighted submits the form. The first one is held back.
    await trackField.press('Enter');
    await expect(formNotice).toBeVisible();
    await expect(formNotice).toContainText(`"${enterName}" is not one of your saved tracks`);
    await expect(page.getByText('tap Save again to keep the name')).toBeVisible();
    await expect(page).toHaveURL(/\/sessions\/new$/);
    expect(await sessionCount(admin, userId)).toBe(0);

    // A different name is a different decision, and a tap on Save is held too.
    const tapName = `PW ${tag} Sonoma`;
    await trackField.fill(tapName);
    await expect(listbox).toBeVisible();
    await expect(formNotice).toHaveCount(0);
    const save = page.getByRole('button', { name: 'Save Session' });
    await save.click();
    await expect(formNotice).toBeVisible();
    await expect(formNotice).toContainText(`"${tapName}" is not one of your saved tracks`);
    await expect(page).toHaveURL(/\/sessions\/new$/);
    expect(await sessionCount(admin, userId)).toBe(0);

    // Having seen it, the rider keeps the name: the second Save goes through.
    await save.click();
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const { data: saved } = await admin
      .from('sessions')
      .select('track_id, track_name')
      .eq('id', page.url().split('/').pop() as string)
      .single();
    expect(saved?.track_id).toBeNull();
    expect(saved?.track_name).toBe(tapName);
  });

  test('is not warned about a copied or restored track that links, after that track was renamed', async ({
    page,
  }, testInfo: TestInfo) => {
    const { admin, tag, email, password, riderId: userId, vehicleId, tracks } =
      await createRiderAtTrackLimit(testInfo);
    const sonoma = tracks.find((track) => track.name.endsWith('Sonoma Raceway'))!;

    // Logged against that row while it was still called something else. Sessions
    // keep the name they were saved with, so the copy carries the old one.
    const oldName = `PW ${tag} Sears Point`;
    const { error: sessionError } = await admin.from('sessions').insert({
      user_id: userId,
      vehicle_id: vehicleId,
      track_id: sonoma.id,
      track_name: oldName,
      date: SESSION_DATE,
      conditions: 'sunny',
      tires: EMPTY_TIRES,
      suspension: EMPTY_SUSPENSION,
    });
    expect(sessionError, sessionError?.message).toBeNull();

    await signInAs(page, email, password);
    await page.goto('/sessions/new');
    await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible({ timeout: 20_000 });

    const trackField = page.getByLabel('Track', { exact: true });
    const formNotice = page.locator('#session-track-limit');

    await expect(async () => {
      await page.getByRole('button', { name: 'Copy last setup' }).click();
      await expect(trackField).toHaveValue(oldName);
    }).toPass({ timeout: 10_000 });
    await expect(formNotice).toHaveCount(0);

    // The same id and stale name, coming back from this device's draft.
    await page.reload();
    await expect(page.getByText('Draft restored from this device.')).toBeVisible({ timeout: 20_000 });
    await expect(trackField).toHaveValue(oldName);
    await expect(formNotice).toHaveCount(0);

    await fillDateAndWeather(page);
    await page.getByRole('button', { name: 'Save Session' }).click();
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    // It linked, under the row's current name - exactly why no warning was due.
    const { data: saved } = await admin
      .from('sessions')
      .select('track_id, track_name')
      .eq('id', page.url().split('/').pop() as string)
      .single();
    expect(saved?.track_id).toBe(sonoma.id);
    expect(saved?.track_name).toBe(sonoma.name);
    await expect(page.getByRole('note').filter({ hasText: getFreePlanLimitTitle('tracks') })).toHaveCount(0);
  });
});
