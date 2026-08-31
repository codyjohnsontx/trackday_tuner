import { randomUUID } from 'node:crypto';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { runResourceId } from '@/tests/e2e/helpers/run-id';
import { EMPTY_SUSPENSION, EMPTY_TIRES } from '@/tests/e2e/helpers/session-fixtures';
import { getFreePlanLimit, getFreePlanLimitTitle } from '@/lib/plans';

/**
 * What a free rider at their limit meets, and where a refused save appears.
 *
 * Reproduced against a free account seeded to 12/10 sessions: `/sessions/new`
 * rendered the whole form - 21 fields, 3,180px on an iPhone viewport - the
 * sticky Save button was on screen from the top of the page, and tapping it put
 * the refusal 2,463px below the fold with no `role`. From the rider's side, they
 * tapped Save and the screen did not change.
 *
 * The same run found the other half: with the bar pinned rather than resting at
 * the end of the document, `sm:bottom-4` put the Save button 44px under the
 * floating nav pill from 640px up, and `document.elementFromPoint` at the middle
 * of "Save Session" returned a nav icon.
 *
 * tests/unit/plan-limit-gate.test.ts locks the helper and the bar's offset off a
 * static render. These are the two facts only a browser can settle: what the
 * gated route actually serves, and what a click at the button's centre hits.
 */

const FREE_SESSION_LIMIT = getFreePlanLimit('sessions');

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

test.describe('a free rider at the session limit', () => {
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
    // Vehicles and sessions cascade from auth.users.
    await createTestAdminClient().auth.admin.deleteUser(riderId);
    riderId = null;
  });

  test('is met by the limit and an upgrade path, not by a form that cannot save', async ({
    page,
  }, testInfo: TestInfo) => {
    const admin = createTestAdminClient();
    const email = `plan-limit-${testInfo.project.name}-${randomUUID()}@example.com`;
    const password = `pw-${randomUUID()}`;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(createError, createError?.message).toBeNull();
    expect(created.user, 'the throwaway rider has to exist to be at a limit').not.toBeNull();
    riderId = created.user!.id;

    const { data: vehicle, error: vehicleError } = await admin
      .from('vehicles')
      .insert({ user_id: riderId, nickname: 'Limit bike', type: 'motorcycle' })
      .select('id')
      .single();
    expect(vehicleError, vehicleError?.message).toBeNull();

    // Exactly the limit: one fewer and the form is the correct answer.
    const { error: seedError } = await admin.from('sessions').insert(
      Array.from({ length: FREE_SESSION_LIMIT }, (_unused, index) => ({
        user_id: riderId as string,
        vehicle_id: vehicle!.id,
        track_name: `Seeded circuit ${index + 1}`,
        date: '2019-06-13',
        conditions: 'sunny' as const,
        tires: EMPTY_TIRES,
        suspension: EMPTY_SUSPENSION,
      })),
    );
    expect(seedError, seedError?.message).toBeNull();

    await signInAs(page, email, password);

    await page.goto('/sessions/new');
    await expect(page.getByRole('heading', { name: getFreePlanLimitTitle('sessions') })).toBeVisible({
      timeout: 20_000,
    });
    // The form the save would have refused never renders.
    await expect(page.locator('#session-track')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save Session' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /upgrade to pro/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to Sessions' })).toBeVisible();

    // The vehicle cap is one on the free plan, and this rider already has one.
    await page.goto('/garage/new');
    await expect(page.getByRole('heading', { name: getFreePlanLimitTitle('vehicles') })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByLabel('Nickname', { exact: true })).toHaveCount(0);
  });
});

test.describe('the sticky Save bar', () => {
  test.describe.configure({ timeout: 120_000 });

  test.skip(!hasE2EAuth(), 'E2E_EMAIL and E2E_PASSWORD env vars are required');
  test.skip(!hasServiceRole(), 'SUPABASE_SERVICE_ROLE_KEY is required to create and remove the vehicle');

  let createdVehicleId: string | null = null;

  test.afterEach(async () => {
    if (!createdVehicleId) return;
    await createTestAdminClient().from('vehicles').delete().eq('id', createdVehicleId);
    createdVehicleId = null;
  });

  test('keeps the Save button clear of the floating nav while it is pinned', async ({
    page,
  }, testInfo: TestInfo) => {
    await signIn(page);
    const runId = runResourceId(testInfo);

    const nickname = `PW Save Bar ${runId}`;
    await page.goto('/garage/new');
    const nicknameField = page.getByLabel('Nickname', { exact: true });
    await expect(async () => {
      await nicknameField.fill(nickname);
      await expect(nicknameField).toHaveValue(nickname);
    }).toPass({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Add Vehicle' }).click();
    await expect(page).toHaveURL(/\/garage$/, { timeout: 20_000 });

    const { data: vehicle } = await createTestAdminClient()
      .from('vehicles')
      .select('id')
      .eq('nickname', nickname)
      .single();
    createdVehicleId = vehicle?.id ?? null;

    await page.goto('/sessions/new');
    await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible({ timeout: 20_000 });

    // Part way down, where the bar is pinned to its offset rather than resting
    // at the end of the document - which is the only place the overlap showed.
    await page.evaluate(() => window.scrollTo(0, Math.round(document.body.scrollHeight * 0.4)));

    await expect(async () => {
      const hitsTheButton = await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === 'Save Session',
        );
        if (!button) return null;
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          Math.round(box.left + box.width / 2),
          Math.round(box.top + box.height / 2),
        );
        return hit ? button.contains(hit) || hit === button : null;
      });

      // A tap at the middle of "Save Session" has to reach the button. It used
      // to reach a nav icon at every width from 640px up.
      expect(hitsTheButton).toBe(true);
    }).toPass({ timeout: 15_000 });
  });
});
