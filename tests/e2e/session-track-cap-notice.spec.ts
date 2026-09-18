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
 * - and that a session with no name still gets the notice it always did.
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

  test.afterEach(async () => {
    if (!riderId) return;
    // Vehicles, tracks and sessions go with the user.
    await createTestAdminClient().auth.admin.deleteUser(riderId);
    riderId = null;
  });

  test('is told the circuit they typed is not on their tracks, before and after Save', async ({
    page,
  }, testInfo: TestInfo) => {
    const admin = createTestAdminClient();
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

    // Exactly the limit: one fewer and the typed circuit becomes a track row.
    const { error: tracksError } = await admin.from('tracks').insert(
      Array.from({ length: FREE_TRACK_LIMIT }, (_unused, index) => ({
        name: `Saved circuit ${index + 1}`,
        is_seeded: false,
        created_by: riderId as string,
      })),
    );
    expect(tracksError, tracksError?.message).toBeNull();

    // A session planted with no name, the way sessions were logged before Track
    // was required, so the existing notice is checked on the same account.
    const { data: trackless, error: tracklessError } = await admin
      .from('sessions')
      .insert({
        user_id: riderId,
        vehicle_id: vehicle!.id,
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

    const typedName = `Thunderhill West ${randomUUID().slice(0, 8)}`;
    await page.goto('/sessions/new');
    await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible({ timeout: 20_000 });

    const vehicleSelect = page.getByLabel('Vehicle', { exact: true });
    await expect(async () => {
      await vehicleSelect.selectOption(vehicle!.id);
      await expect(vehicleSelect).toHaveValue(vehicle!.id);
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
    await trackField.fill('saved  CIRCUIT 2');
    await page.keyboard.press('Escape');
    await expect(formNotice).toHaveCount(0);
    await trackField.fill(typedName);
    await expect(formNotice).toBeVisible();

    await page.getByLabel('Date', { exact: true }).fill(SESSION_DATE);
    await page.getByRole('group', { name: 'Weather' }).getByRole('button', { name: 'Sunny' }).click();
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
});
