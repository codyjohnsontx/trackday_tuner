import { expect, type Page } from '@playwright/test';
import { createTestAdminClient } from '@/tests/e2e/helpers/supabase';

/**
 * What the Track picker specs share: a saved circuit and a vehicle made through
 * the app the way a rider makes them, and the typed query that narrows the
 * suggestion list to this run's rows.
 */

export async function seedTrack(page: Page, name: string): Promise<string> {
  await page.goto('/tracks/new');

  const field = page.getByLabel('Track name', { exact: true });
  await expect(async () => {
    await field.fill(name);
    await expect(field).toHaveValue(name);
  }).toPass({ timeout: 10_000 });

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

export async function addVehicle(page: Page, nickname: string): Promise<string> {
  await page.goto('/garage/new');

  const nicknameField = page.getByLabel('Nickname', { exact: true });
  await expect(async () => {
    await nicknameField.fill(nickname);
    await expect(nicknameField).toHaveValue(nickname);
  }).toPass({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Add Vehicle' }).click();
  await expect(page).toHaveURL(/\/garage$/, { timeout: 20_000 });

  const { data, error } = await createTestAdminClient()
    .from('vehicles')
    .select('id')
    .eq('nickname', nickname)
    .single();

  if (error || !data) {
    throw new Error(`Vehicle "${nickname}" was not created: ${error?.message ?? 'no row returned'}`);
  }

  return data.id;
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
