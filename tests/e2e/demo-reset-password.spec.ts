import { expect, test, type Page } from '@playwright/test';
import { hasE2EAuth, signIn } from '@/tests/e2e/helpers/auth';

/**
 * A rider in demo mode who clicks a password-reset link.
 *
 * `/auth/callback` trades the recovery code for a real session before it
 * redirects, so from `/reset-password` onwards the rider holds a demo cookie
 * *and* a live session. Demo outranks a session everywhere in the app, so the
 * page cannot show the password form yet and asks them to leave the demo first.
 *
 * The dead end this guards: leaving the demo used to drop the destination.
 * `/demo/exit` always went to `/login`, `/login` forwards anyone already signed
 * in to `/dashboard`, and nothing there links back - so the rider landed on a
 * signed-in dashboard, still on their old password, with no way to finish.
 *
 * These specs cannot mint a recovery link, which needs a mailbox. They do not
 * need to: the routing cannot tell one session from another, so an ordinary
 * sign-in reproduces the same "signed in, in the demo, wants to reset" state a
 * recovery link produces, and that state is what broke.
 */

/**
 * `next dev` rebuilds `request.url` with `localhost` whatever Host arrived, so a
 * redirect out of a route handler lands on a different origin - and a different
 * cookie scope - than the 127.0.0.1 this suite drives. A deployed build uses the
 * forwarded host and stays put. Re-entering on the base origin picks the cookie
 * back up without changing which path the app chose, which is what is under test.
 */
async function enterDemo(page: Page) {
  // Retried as a unit because that redirect chain is not atomic: it can still be
  // resolving when the next navigation starts, which Playwright reports as one
  // navigation interrupting another. Where `/demo` itself lands is not the
  // point, so re-entering on the base origin is what the assertion is on.
  await expect(async () => {
    await page.goto('/demo');
    await page.goto('/dashboard');
    await expect(page.getByText('You are viewing sample data.', { exact: false })).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: 25_000 });

  // Let the chain finish before the spec navigates again, so a late hop cannot
  // interrupt it.
  await page.waitForLoadState('networkidle');
}

/**
 * Click "Exit Demo" and report the path the browser was actually sent to.
 *
 * Neither the URL nor the demo cookie can be polled for this. `page.url()` still
 * reads `/reset-password` for a moment after the click - which is also where the
 * fix lands - so a poll passes before the navigation begins. The cookie is worse:
 * the router fetches `/demo/exit` once before handing the browser the redirect,
 * so the cookie is already gone while the old page is still on screen. The
 * top-level navigation request to somewhere other than `/demo/exit` is the first
 * unambiguous signal, and reading its path rather than its URL keeps this
 * independent of which host `next dev` rebuilt the redirect with.
 */
async function clickExitDemo(page: Page): Promise<string> {
  const landed = page.waitForRequest(
    (request) =>
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame() &&
      new URL(request.url()).pathname !== '/demo/exit',
    { timeout: 20_000 },
  );

  await page.getByRole('link', { name: 'Exit Demo' }).click();

  const destination = new URL((await landed).url()).pathname;
  await page.waitForLoadState('load');
  return destination;
}

test.describe('password reset from demo mode', () => {
  // One run of the first test declares more waiting than the 30s global budget in
  // playwright.config.ts allows: signIn's 20s URL wait, enterDemo's 25s toPass,
  // a networkidle on Playwright's 30s default, then clickExitDemo's 20s
  // waitForRequest. Six device projects share one dev server compiling routes on
  // demand, so at 30s the first attempt dies inside page.goto and the retry loop
  // enterDemo was written for never gets to spend its budget. 120s covers that
  // sum with headroom. If a wait below grows, grow this number too - none of them
  // may be shortened to fit a budget.
  test.describe.configure({ timeout: 120_000 });

  test('a signed-in rider leaving the demo reaches the password form', async ({ page }) => {
    test.skip(!hasE2EAuth(), 'Needs E2E_EMAIL and E2E_PASSWORD to hold a real session.');

    await signIn(page);
    // Entering the demo does not sign a rider out. This is the state a recovery
    // link lands in.
    await enterDemo(page);

    await page.goto('/reset-password');
    await expect(page.getByText('You are browsing the demo right now.')).toBeVisible();

    // The defect itself: this used to land on /login, which forwards a rider who
    // is already signed in to /dashboard, where nothing mentions the reset again.
    expect(await clickExitDemo(page)).toBe('/reset-password');

    await page.goto('/reset-password');
    await expect(page.getByRole('button', { name: 'Save New Password' })).toBeVisible();
  });

  test('leaving the demo from the reset page returns to the reset page', async ({ page }) => {
    await enterDemo(page);

    await page.goto('/reset-password');
    await expect(page.getByRole('link', { name: 'Exit Demo' })).toBeVisible();

    // With no session the reset page reports the link expired and offers a way
    // back, which a rider can act on. Being dropped on /login or /dashboard with
    // the reset never mentioned again is not.
    expect(await clickExitDemo(page)).toBe('/reset-password');
  });
});
