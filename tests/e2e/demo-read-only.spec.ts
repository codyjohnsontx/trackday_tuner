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
    await expect(page.getByRole('heading', { name: 'Read-only demo' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Save Entry' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Label (optional)')).toHaveCount(0);

    // The calculator itself still works.
    const front = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Front' }) });
    await front.getByLabel('Fully Extended (L0)').fill('600');
    await front.getByLabel('Bike Only (L1)').fill('570');
    await front.getByLabel('Rider On Bike (L2)').fill('560');
    await expect(front.getByText('30.0 mm')).toBeVisible();
    await expect(front.getByText('40.0 mm')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
  });

  test("the sag calculator leaves this device's real draft alone", async ({ page, baseURL }) => {
    const draftKey = 'track_tuner:draft:sag_calculator';
    const riderDraft = JSON.stringify({
      front: { l0: '610', l1: '585', l2: '575', travel: '120' },
      rear: { l0: '', l1: '', l2: '', travel: '' },
      label: 'New springs',
      notes: 'Unsaved notes',
    });
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [draftKey, riderDraft] as const);
    await enterDemo(page, baseURL!);
    await page.goto('/sag');

    const front = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Front' }) });
    await expect(front.getByLabel('Fully Extended (L0)')).toHaveValue('');
    await front.getByLabel('Fully Extended (L0)').fill('600');
    await expect(front.getByLabel('Fully Extended (L0)')).toHaveValue('600');
    expect(await page.evaluate((key) => window.localStorage.getItem(key), draftKey)).toBe(riderDraft);

    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(front.getByLabel('Fully Extended (L0)')).toHaveValue('');
    expect(await page.evaluate((key) => window.localStorage.getItem(key), draftKey)).toBe(riderDraft);
  });

  test('the service book is a tour: every screen reads, none saves', async ({ page, baseURL }) => {
    await enterDemo(page, baseURL!);
    await page.goto('/garage/demo-r6/book');

    await expect(page.getByText('You are viewing sample data.', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Service book' })).toBeVisible();
    await expect(page.getByText('Engine oil and filter').first()).toBeVisible();
    await expect(page.getByText('Logged the day of service').first()).toBeVisible();
    await expect(page.getByText('Back-filled 38 days later')).toBeVisible();
    await expect(page.getByRole('link', { name: '+ Log service' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Log a reading' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await expect(page.locator('form')).toHaveCount(0);

    await page.getByTestId('service-entry-row').first().click();
    await expect(page.getByRole('heading', { name: /^\d+ revisions?$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hold to remove' })).toHaveCount(0);
    await expect(page.locator('form')).toHaveCount(0);

    for (const path of ['/garage/demo-r6/book/entries/new', '/garage/demo-r6/book/settings']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Read-only demo' })).toBeVisible();
      await expect(page.locator('form')).toHaveCount(0);
    }
  });
});
