import { expect, type Locator, type Page } from '@playwright/test';
import { createTestAdminClient } from '@/tests/e2e/helpers/supabase';

/** Adds a vehicle through the garage form, the way a rider does, and returns its id. */
export async function addVehicle(page: Page, nickname: string): Promise<string> {
  await page.goto('/garage/new');

  const nicknameField = page.getByLabel('Nickname', { exact: true });
  const addButton = page.getByRole('button', { name: 'Add Vehicle' });
  // Text typed into the streamed HTML before React hydrates stays in the field
  // but never reaches state, so `toHaveValue` passes while Add Vehicle stays
  // disabled for good. The button is enabled only by a nickname in state, so
  // its being enabled is the fill having been seen. The field is cleared first
  // because React drops an input event that leaves the value it last saw as it
  // was, so refilling the same nickname after hydration would not register.
  await expect(async () => {
    await nicknameField.clear();
    await nicknameField.fill(nickname);
    await expect(nicknameField).toHaveValue(nickname);
    await expect(addButton).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });

  await addButton.click();
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

/**
 * Types a bike's nickname into its delete confirmation on the edit page, the
 * way a rider does, and returns the Delete vehicle button it enabled. The same
 * hydration gap as `addVehicle`: the button is enabled only by the nickname in
 * state, so its being enabled is the fill having been seen.
 */
export async function confirmVehicleDelete(page: Page, nickname: string): Promise<Locator> {
  const field = page.getByLabel(`Type ${nickname} to confirm`);
  const deleteButton = page.getByRole('button', { name: 'Delete vehicle' });
  await expect(async () => {
    await field.clear();
    await field.fill(nickname);
    await expect(field).toHaveValue(nickname);
    await expect(deleteButton).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  return deleteButton;
}
