import { expect, type Page } from '@playwright/test';
import { createTestAdminClient } from '@/tests/e2e/helpers/supabase';

/**
 * What the Track picker specs share: a saved circuit made through the app the
 * way a rider makes one, and the typed query that narrows the suggestion list to
 * this run's rows.
 */

export async function seedTrack(page: Page, name: string): Promise<string> {
  await page.goto('/tracks/new');
  await fillTrackForm(page, { name });

  await page.getByRole('button', { name: /add track/i }).click();
  await expect(page).toHaveURL(/\/tracks$/, { timeout: 20_000 });

  const { data, error } = await createTestAdminClient()
    .from('tracks')
    .select('id')
    .eq('name', name)
    .single();

  if (error || !data) {
    throw new Error(`Track "${name}" was not created: ${error?.message ?? 'no row returned'}`);
  }

  return data.id;
}

/**
 * Fills the new-track form so React holds the values, not just the DOM. Text
 * typed into the streamed HTML before React hydrates stays in the field but
 * never reaches state, and Add Track then answers "Track name is required."
 * The form drafts its state to this device on every change, so the draft
 * holding the values is the fill having been seen. Each field is cleared first
 * because React drops an input event that leaves the value it last saw as it
 * was, so refilling the same text after hydration would not register.
 */
export async function fillTrackForm(page: Page, values: { name: string; location?: string }) {
  const nameField = page.getByLabel('Track name', { exact: true });
  const locationField = page.getByLabel('Location (optional)');
  const expected = { name: values.name, location: values.location ?? '' };

  await expect(async () => {
    await nameField.clear();
    await nameField.fill(expected.name);
    await locationField.clear();
    await locationField.fill(expected.location);
    await expect
      .poll(
        async () =>
          JSON.parse(
            (await page.evaluate(() => window.localStorage.getItem('track_tuner:draft:track_form_new'))) ?? 'null',
          ),
        { timeout: 1_000 },
      )
      .toEqual(expected);
  }).toPass({ timeout: 10_000 });
}

/** Narrows the suggestion list to this run's one circuit. */
export async function typeRunQuery(page: Page, runId: string) {
  const trackField = page.locator('#session-track');
  const listbox = page.locator('#session-track-listbox');

  await expect(async () => {
    await trackField.fill(runId);
    await expect(listbox.getByRole('option')).toHaveCount(1);
  }).toPass({ timeout: 15_000 });

  return { trackField, listbox };
}
