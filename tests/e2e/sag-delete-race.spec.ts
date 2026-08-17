import { test, expect, type Page } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';

/**
 * Deleting one sag entry while the rider taps another.
 *
 * `removeEntry` clears the selection when the deleted entry was the loaded one,
 * and that comparison happens after an await. Reading it from the render that
 * created the handler meant a rider who tapped entry B while A was still
 * deleting had B silently deselected and B's freshly loaded measurements marked
 * as unsaved work - so the next tap asked to overwrite them for no reason.
 *
 * The race needs a slow delete to be observable at all, so the delete is held
 * open here rather than raced against real latency: the window is this test's to
 * control, which is what makes the result the same every run.
 */

const RUN = `${process.env.TEST_WORKER_INDEX ?? '0'}-${Date.now()}`;
const ENTRY_A = `PW Race A ${RUN}`;
const ENTRY_B = `PW Race B ${RUN}`;
const SIDE_A = { l0: '590', l1: '560', l2: '555' };
const SIDE_B = { l0: '600', l1: '572', l2: '566' };

async function fillFront(page: Page, values: { l0: string; l1: string; l2: string }) {
  const front = page.locator('section').filter({ hasText: 'Front' }).first();
  for (const [label, value] of [
    ['Fully Extended (L0)', values.l0],
    ['Bike Only (L1)', values.l1],
    ['Rider On Bike (L2)', values.l2],
  ] as const) {
    const field = front.getByLabel(label);
    await expect(async () => {
      await field.fill(value);
      await expect(field).toHaveValue(value);
    }).toPass({ timeout: 10_000 });
  }
}

async function saveEntry(page: Page, label: string, values: { l0: string; l1: string; l2: string }) {
  await fillFront(page, values);
  await page.getByLabel('Label (optional)').fill(label);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Sag entry saved.')).toBeVisible({ timeout: 20_000 });
}

test.describe('deleting a sag entry while another is tapped', () => {
  test.describe.configure({ timeout: 120_000 });

  test.skip(!hasE2EAuth(), 'E2E_EMAIL and E2E_PASSWORD env vars are required');
  test.skip(!hasServiceRole(), 'SUPABASE_SERVICE_ROLE_KEY is required to clean up entries');

  test.afterEach(async () => {
    await createTestAdminClient().from('sag_entries').delete().in('label', [ENTRY_A, ENTRY_B]);
  });

  test('leaves the entry the rider moved to selected and its measurements committed', async ({
    page,
  }) => {
    await signIn(page);

    await page.goto('/sag');
    await page.evaluate(() => localStorage.removeItem('track_tuner:draft:sag_calculator'));
    await page.reload();

    await saveEntry(page, ENTRY_A, SIDE_A);
    await saveEntry(page, ENTRY_B, SIDE_B);

    const rowA = page.getByRole('listitem').filter({ hasText: ENTRY_A });
    const rowB = page.getByRole('listitem').filter({ hasText: ENTRY_B });

    // Load A, so A is the selection the delete below is about to remove.
    await rowA.getByRole('button', { name: ENTRY_A }).click();
    await expect(page.getByText('Loaded saved entry.')).toBeVisible();

    // Hold the delete open. Only the delete is delayed: it is armed after both
    // saves and the load have already gone through.
    let releaseDelete: (() => void) | null = null;
    const deleteHeld = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    await page.route('**/sag', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await deleteHeld;
      return route.continue();
    });

    const deleteA = rowA.getByRole('button', { name: /Hold to delete/ });
    await deleteA.hover();
    await page.mouse.down();
    await page.waitForTimeout(1_400);
    await page.mouse.up();

    // Mid-flight, the rider changes their mind and opens B.
    await rowB.getByRole('button', { name: ENTRY_B }).click();
    await expect(page.getByText('Loaded saved entry.')).toBeVisible();
    const front = page.locator('section').filter({ hasText: 'Front' }).first();
    await expect(front.getByLabel('Fully Extended (L0)')).toHaveValue(SIDE_B.l0);

    // Now let the delete land.
    releaseDelete!();
    await expect(page.getByRole('listitem').filter({ hasText: ENTRY_A })).toHaveCount(0, {
      timeout: 20_000,
    });

    // B is still the loaded entry and its measurements are still committed, so
    // reopening it is not treated as overwriting unsaved work. Under the stale
    // read this asks for confirmation instead.
    await rowB.getByRole('button', { name: ENTRY_B }).click();
    await expect(page.getByText(/Loading this entry replaces the measurements on screen/)).toHaveCount(0);
  });
});
