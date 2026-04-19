import { expect, type Page } from '@playwright/test';

export function hasE2EAuth(): boolean {
  return Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);
}

export async function signIn(page: Page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error('E2E_EMAIL and E2E_PASSWORD are required.');
  }

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^Sign In$/ }).first().click();
  await expect(page).toHaveURL(/\/dashboard/);
}
