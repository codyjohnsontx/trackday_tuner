import type { Page } from '@playwright/test';

/**
 * `page.goto` that survives the dev server reloading the page it is leaving.
 *
 * The first request for a route makes `next dev` compile it, and the HMR
 * message that follows can tell the page still open - usually /dashboard after
 * `signInWith` - to do a full reload. When that reload lands before the new
 * navigation commits, the goto fails: WebKit says "interrupted by another
 * navigation", Chromium says `net::ERR_ABORTED`. Only those are retried, and a
 * genuine abort still fails once the attempts run out.
 */
export async function gotoPage(page: Page, url: string, attempts = 3): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.goto(url);
      return;
    } catch (error) {
      const interrupted =
        error instanceof Error &&
        /interrupted by another navigation|net::ERR_ABORTED/.test(error.message);
      if (!interrupted || attempt >= attempts) throw error;
      await page.waitForLoadState('load');
    }
  }
}
