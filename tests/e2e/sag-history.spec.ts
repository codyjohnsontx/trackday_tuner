import { test, expect, type Page } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { runResourceId } from '@/tests/e2e/helpers/run-id';

/**
 * The sag history was a list of timestamps: an entry saved without a label read
 * "Untitled Entry" and showed none of its measurements, tapping one silently
 * replaced whatever was on screen, and there was no way to remove anything -
 * even though `sag_entries` shipped with a delete policy and grant.
 *
 * All three are things a rider does with their thumb, so all three are asserted
 * through the browser.
 */

const FRONT = { l0: '590', l1: '560', l2: '555' };
const UNSAVED = { l0: '600', l1: '572', l2: '566' };

async function fillFront(page: Page, values: { l0: string; l1: string; l2: string }) {
  const front = page.locator('section').filter({ hasText: 'Front' }).first();
  for (const [label, value] of [
    ['Fully Extended (L0)', values.l0],
    ['Bike Only (L1)', values.l1],
    ['Rider On Bike (L2)', values.l2],
  ] as const) {
    const field = front.getByLabel(label);
    // Controlled inputs: a value typed before hydration is thrown away.
    await expect(async () => {
      await field.fill(value);
      await expect(field).toHaveValue(value);
    }).toPass({ timeout: 10_000 });
  }
}

test.describe('the sag history', () => {
  test.describe.configure({ timeout: 120_000 });

  test.skip(!hasE2EAuth(), 'E2E_EMAIL and E2E_PASSWORD env vars are required');
  test.skip(!hasServiceRole(), 'SUPABASE_SERVICE_ROLE_KEY is required to clean up entries');

  // Every device project drives the same E2E account, so a label shared between
  // them puts two rows on screen: the row locator trips strict mode and the
  // final toHaveCount(0) sees the other project's surviving row. The worker index
  // repeats across projects, so the identifier carries the project name too.
  let label = '';

  test.afterEach(async () => {
    if (!label) return;
    await createTestAdminClient().from('sag_entries').delete().eq('label', label);
    label = '';
  });

  test('shows what each entry measured, asks before replacing unsaved work, and deletes', async ({
    page,
  }, testInfo) => {
    label = `PW Sag ${runResourceId(testInfo)}`;
    await signIn(page);

    await page.goto('/sag');
    // A draft restored from a previous run would count as unsaved work and change
    // what this test is exercising.
    await page.evaluate(() => localStorage.removeItem('track_tuner:draft:sag_calculator'));
    await page.reload();

    await fillFront(page, FRONT);
    await page.getByLabel('Label (optional)').fill(label);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Sag entry saved.')).toBeVisible({ timeout: 20_000 });

    // The row carries the measurements, not just a timestamp.
    const row = page.getByRole('listitem').filter({ hasText: label });
    await expect(row).toContainText('30.0');
    await expect(row).toContainText('35.0');

    // Measurements typed after the save are not in any entry.
    await fillFront(page, UNSAVED);
    await row.getByRole('button', { name: label }).click();
    await expect(page.getByText(/Loading this entry replaces the measurements on screen/)).toBeVisible();

    await page.getByRole('button', { name: 'Keep editing' }).click();
    const front = page.locator('section').filter({ hasText: 'Front' }).first();
    await expect(front.getByLabel('Fully Extended (L0)')).toHaveValue(UNSAVED.l0);
    await expect(front.getByLabel('Bike Only (L1)')).toHaveValue(UNSAVED.l1);
    await expect(front.getByLabel('Rider On Bike (L2)')).toHaveValue(UNSAVED.l2);

    // Asking again and accepting does load it.
    await row.getByRole('button', { name: label }).click();
    await page.getByRole('button', { name: 'Load anyway' }).click();
    await expect(front.getByLabel('Fully Extended (L0)')).toHaveValue(FRONT.l0);

    // Deleting is a deliberate hold, and it removes the row.
    const deleteButton = row.getByRole('button', { name: /Hold to delete/ });
    await deleteButton.hover();
    await page.mouse.down();
    await page.waitForTimeout(1_400);
    await page.mouse.up();

    await expect(page.getByRole('listitem').filter({ hasText: label })).toHaveCount(0, {
      timeout: 20_000,
    });

    const { data } = await createTestAdminClient()
      .from('sag_entries')
      .select('id')
      .eq('label', label);
    expect(data).toHaveLength(0);
  });
});
