import { test, expect } from '@playwright/test';

const E2E_EMAIL = process.env.E2E_EMAIL;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const GOOGLE_ENABLED = (process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED ?? 'true') === 'true';
const APPLE_ENABLED = (process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED ?? 'false') === 'true';

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
    const googleButton = page.getByRole('button', { name: 'Continue with Google' });
    const appleButton = page.getByRole('button', { name: 'Continue with Apple' });
    await expect(googleButton).toBeVisible();
    await expect(appleButton).toBeVisible();
    if (GOOGLE_ENABLED) {
      await expect(googleButton).toBeEnabled();
    } else {
      await expect(googleButton).toBeDisabled();
    }
    if (APPLE_ENABLED) {
      await expect(appleButton).toBeEnabled();
    } else {
      await expect(appleButton).toBeDisabled();
    }
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

test.describe('authenticated tracks smoke', () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, 'E2E_EMAIL and E2E_PASSWORD env vars are required');

  test('can create, search, and view a custom track', async ({ page }) => {
    await signIn(page);

    const trackName = `PW Track ${Date.now()}`;
    const location = 'Austin, TX';

    await page.goto('/tracks/new');
    await expect(page.getByRole('heading', { name: 'Add Track' })).toBeVisible();
    await page.getByLabel('Track name').fill(trackName);
    await page.getByLabel('Location (optional)').fill(location);
    await page.getByRole('button', { name: 'Add Track' }).click();

    await expect(page).toHaveURL(/\/tracks$/);
    await page.getByLabel('Search tracks').fill(trackName);
    await expect(page.getByText(trackName)).toBeVisible();

    const trackRow = page.locator('li').filter({ hasText: trackName }).first();
    await trackRow.getByRole('link', { name: 'View' }).click();
    await expect(page).toHaveURL(/\/tracks\//);
    await expect(page.getByRole('heading', { name: trackName })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent Sessions' })).toBeVisible();
  });

  test('can navigate dashboard, sessions, and tracks routes', async ({ page }) => {
    await signIn(page);

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/sessions');
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();

    await page.goto('/tracks');
    await expect(page.getByRole('heading', { name: 'Tracks' })).toBeVisible();
  });
});

test.describe('authenticated converter smoke', () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, 'E2E_EMAIL and E2E_PASSWORD env vars are required');

  test('supports presets, dropdown units, swap, and recents', async ({ page }) => {
    await signIn(page);

    await page.goto('/tools');
    await page.getByRole('link', { name: 'Unit Converter' }).click();
    await expect(page).toHaveURL(/\/tools\/converter/);
    await expect(page.getByRole('heading', { name: 'Unit Converter' })).toBeVisible();

    await page.getByLabel('Value').fill('32');
    await expect(page.getByText('2.206')).toBeVisible();

    await page.getByRole('button', { name: 'Convert + Save Pair' }).click();
    await expect(page.getByRole('heading', { name: 'Recent (Top 5)' })).toBeVisible();

    await page.getByLabel('Category').selectOption('mass');
    await page.getByLabel('From').selectOption('lb');
    await page.getByLabel('To').selectOption('kg');
    await page.getByLabel('Value').fill('10');
    await expect(page.getByText('4.536')).toBeVisible();

    await page.getByRole('button', { name: 'Swap' }).click();
    await expect(page.getByText('22.046')).toBeVisible();
    await page.getByRole('button', { name: 'Convert + Save Pair' }).click();

    await page.getByLabel('Category').selectOption('spring_rate');
    await page.getByLabel('From').selectOption('N/mm');
    await page.getByLabel('To').selectOption('lb/in');
    await page.getByLabel('Value').fill('10');
    await expect(page.getByText('57.101')).toBeVisible();

    const recentButtons = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Recent (Top 5)' }) })
      .getByRole('button');

    await expect(recentButtons.first()).toHaveText('kg → lb');
  });
});
