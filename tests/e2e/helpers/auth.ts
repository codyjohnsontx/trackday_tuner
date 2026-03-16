import { expect, type Page } from '@playwright/test';

export const E2E_EMAIL = process.env.E2E_EMAIL;
export const E2E_PASSWORD = process.env.E2E_PASSWORD;

export function hasE2EAuth(): boolean {
  return Boolean(E2E_EMAIL && E2E_PASSWORD);
}

export async function signIn(page: Page) {
  if (!E2E_EMAIL || !E2E_PASSWORD) {
    throw new Error('E2E_EMAIL and E2E_PASSWORD are required for authenticated Playwright tests.');
  }

  await page.goto('/login');
  await page.getByRole('button', { name: /^Sign In$/ }).first().click();
  await page.getByLabel('Email').fill(E2E_EMAIL);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: /^Sign In$/ }).nth(1).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
