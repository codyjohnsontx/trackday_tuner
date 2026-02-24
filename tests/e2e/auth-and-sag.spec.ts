import { test, expect } from '@playwright/test';

const E2E_EMAIL = process.env.E2E_EMAIL;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: /^Sign In$/ }).first().click();
  await page.getByLabel('Email').fill(E2E_EMAIL!);
  await page.getByLabel('Password').fill(E2E_PASSWORD!);
  await page.getByRole('button', { name: /^Sign In$/ }).nth(1).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe('unauthenticated route guards', () => {
  test('redirects /dashboard to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects /sag to /login', async ({ page }) => {
    await page.goto('/sag');
    await expect(page).toHaveURL(/\/login/);
  });

  test('renders login page controls', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Sign In$/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Sign Up$/ })).toBeVisible();
  });
});

test.describe('authenticated sag smoke', () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, 'E2E_EMAIL and E2E_PASSWORD env vars are required');

  test('can access tools and open sag calculator', async ({ page }) => {
    await signIn(page);

    await expect(page.getByRole('link', { name: 'Tools' })).toBeVisible();
    await page.getByRole('link', { name: 'Tools' }).click();
    await expect(page).toHaveURL(/\/tools/);
    await expect(page.getByRole('heading', { name: 'Tools' })).toBeVisible();

    await page.getByRole('link', { name: 'Sag Calculator' }).click();
    await expect(page).toHaveURL(/\/sag/);
    await expect(page.getByRole('heading', { name: 'Sag Calculator' })).toBeVisible();
  });

  test('shows live sag calculations and warnings', async ({ page }) => {
    await signIn(page);
    await page.goto('/sag');

    const frontSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Front' }) });
    const rearSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Rear' }) });

    await frontSection.getByLabel('Fully Extended (L0)').fill('120');
    await frontSection.getByLabel('Bike Only (L1)').fill('100');
    await frontSection.getByLabel('Rider On Bike (L2)').fill('90');

    await expect(frontSection.getByText('20.0 mm')).toBeVisible();
    await expect(frontSection.getByText('30.0 mm')).toBeVisible();

    await rearSection.getByLabel('Fully Extended (L0)').fill('130');
    await rearSection.getByLabel('Bike Only (L1)').fill('110');
    await rearSection.getByLabel('Rider On Bike (L2)').fill('100');

    await expect(rearSection.getByText('20.0 mm')).toBeVisible();
    await expect(rearSection.getByText('30.0 mm')).toBeVisible();

    await frontSection.getByLabel('Bike Only (L1)').fill('140');
    await expect(frontSection.getByText('Check measurements: L0 should be the largest number.')).toBeVisible();
  });
});
