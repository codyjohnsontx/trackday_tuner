import { expect, test } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';
import { makeRunId } from '@/tests/e2e/helpers/data';

test.describe('track lifecycle', () => {
  test.skip(!hasE2EAuth(), 'E2E_EMAIL and E2E_PASSWORD env vars are required');

  test('creates a custom track, exposes it in new-session track picker, and deletes it', async ({ page }) => {
    await signIn(page);

    const runId = makeRunId('pw-track');
    const trackName = `${runId} Circuit`;
    const location = 'Austin, TX';

    await page.goto('/tracks/new');
    await expect(page.getByRole('heading', { name: 'Add Track' })).toBeVisible();
    await page.getByLabel('Track name').fill(trackName);
    await page.getByLabel('Location (optional)').fill(location);
    await page.getByRole('button', { name: 'Add Track' }).click();

    await expect(page).toHaveURL(/\/tracks$/);
    await page.getByLabel('Search tracks').fill(trackName);

    const customTracksSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Your Custom Tracks' }),
    });
    const trackRow = customTracksSection.locator('li').filter({ hasText: trackName }).first();

    await expect(trackRow).toBeVisible();
    await expect(trackRow).toContainText(location);

    await page.goto('/sessions/new');
    await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible();
    await page.getByLabel('Track').click();
    await page.getByLabel('Track').fill(trackName);

    const trackOption = page.getByRole('button', { name: new RegExp(trackName) }).first();
    await expect(trackOption).toBeVisible();
    await trackOption.click();
    await expect(page.getByLabel('Track')).toHaveValue(trackName);

    await page.goto('/tracks');
    await page.getByLabel('Search tracks').fill(trackName);
    await expect(trackRow).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await trackRow.getByRole('button', { name: 'Delete Track' }).click();
    await expect(trackRow).not.toBeVisible();
    await expect(customTracksSection).toContainText('No custom tracks match your search.');
  });
});
