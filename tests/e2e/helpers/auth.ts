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

  // The login page has two controls named "Sign In": the mode toggle above the
  // form, and the form's own submit button. Scoping to the form picks the one
  // that actually signs in — clicking the toggle just reselects the current mode
  // and leaves the test sitting on /login.
  const form = page.locator('form');
  const emailField = form.getByLabel('Email');
  const passwordField = form.getByLabel('Password');

  // These are controlled inputs, so a value typed into the streamed HTML before
  // React hydrates gets thrown away. Retry until it sticks.
  await expect(async () => {
    await emailField.fill(email);
    await passwordField.fill(password);
    await expect(emailField).toHaveValue(email);
    await expect(passwordField).toHaveValue(password);
  }).toPass({ timeout: 10_000 });

  await form.getByRole('button', { name: /^Sign In$/ }).click();
  // Signing in is a network round trip plus a client navigation that renders
  // /dashboard on the server. Several device projects share one dev server, so the
  // default 5s expectation trips on a sign-in that is merely slow, not failed.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}
