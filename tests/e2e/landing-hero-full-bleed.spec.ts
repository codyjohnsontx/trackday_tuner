import { test, expect } from '@playwright/test';

/**
 * The landing hero is full bleed: its photo reaches both viewport edges on a
 * desktop wider than the app shell's 1024px cap. It used to escape only
 * `main`'s padding, so at 1200px the photo stopped at x=1112 against a flat
 * canvas band and at 1920px the lead rider was sliced off at x=1472. The
 * device projects this suite gates on are narrower than the cap, where the
 * defect never showed, so the viewport is widened here on purpose.
 *
 * The break-out is `calc(50% - 50vw)`, and `100vw` includes a classic
 * scrollbar, so the shell clips horizontal overflow; the scroll-width check is
 * what proves the clip holds rather than the page gaining a sideways scroll.
 */
const WIDTHS = [1200, 1440, 1920];

for (const width of WIDTHS) {
  test(`hero photo fills the viewport width at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');

    const heading = page.getByRole('heading', { name: 'Know what changed. Learn what worked.' });
    await expect(heading).toBeVisible();

    const photo = page.locator('main section img[src*="gpslide"]').first();
    await expect(photo).toBeAttached();
    const box = await photo.boundingBox();
    expect(box).not.toBeNull();
    const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(Math.round(box!.x)).toBe(0);
    expect(Math.round(box!.x + box!.width)).toBe(viewportWidth);

    // The copy stays on the capped column: its left edge is the same
    // distance from the viewport centre it was when the section was 1024px.
    const headingBox = await heading.boundingBox();
    expect(headingBox).not.toBeNull();
    expect(Math.round(headingBox!.x)).toBe(Math.round(viewportWidth / 2 - 448));

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBe(overflow.clientWidth);
  });
}
