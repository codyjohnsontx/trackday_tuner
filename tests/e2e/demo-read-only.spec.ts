import { expect, test, type Page } from '@playwright/test';

/**
 * The public demo is read-only (owner, 2026-10-04): a visitor is never offered a
 * save. The sag calculator was the one screen that still offered one - a Save
 * button that only answered with the read-only error after the click.
 *
 * Needs no account and no database: the demo reads fixtures.
 */
async function enterDemo(page: Page, baseURL: string) {
  // The cookie `/demo` sets, set directly: under `next dev` that redirect is
  // rebuilt on `localhost`, a different cookie scope from the 127.0.0.1 this
  // suite drives, and entering the demo is not what this spec is about.
  await page.context().addCookies([{ name: 'trackday_tuner_demo', value: '1', url: baseURL }]);
}

test.describe('demo is read-only', () => {
  test('the sag calculator works but offers no save', async ({ page, baseURL }) => {
    await enterDemo(page, baseURL!);
    await page.goto('/sag');

    await expect(page.getByText('You are viewing sample data.', { exact: false })).toBeVisible();
    await expect(page.getByText('Demo mode is read-only. Start a real account to save sag entries.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Label (optional)')).toHaveCount(0);

    // The calculator itself still works.
    const front = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Front' }) });
    await front.getByLabel('Fully Extended (L0)').fill('600');
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
  });
});
