import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards the page-title face recorded in CLAUDE.md ("Type"): Barlow Semi
// Condensed 600, loaded once in app/layout.tsx, reaching the `font-display`
// utility through `--font-display` in the `@theme` block of app/globals.css,
// and worn only by `pageTitleClass` in components/ui/page-header.tsx.
//
// The face is a chain of three files that have to agree, and nothing else
// checks the links: next/font happily loads a family nobody references, the
// `@theme` token happily names a CSS variable nothing sets, and the utility
// happily falls through to the fallback stack with no build warning. The
// owner's pick would then be "live" and every title would quietly render in
// the system sans. So this locks the chain, link by link.
//
// WHAT IT CATCHES:
//   - the layout loading a different family or weight, or dropping the
//     `variable` that hands the face to CSS
//   - `--font-display` not starting from that same variable, or the fallback
//     stack drifting back to a serif
//   - `pageTitleClass` losing `font-display`, or any other module in
//     components/ or app/ reaching for `font-display` directly, which is the
//     "every card is a title" drift the page-header comment warns about
//
// WHAT IT DOES NOT CATCH: whether the font file actually loads and renders.
// That is a browser question, answered by the screenshots on the pull request.

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');
}

const layout = read('app/layout.tsx');
const globalsCss = read('app/globals.css');
const pageHeader = read('components/ui/page-header.tsx');

const FAMILY_IMPORT = 'Barlow_Semi_Condensed';
const FONT_VARIABLE = '--font-barlow-semi-condensed';

function themeBlock(css: string): string {
  const start = css.indexOf('@theme {');
  expect(start, 'app/globals.css must declare an @theme block').toBeGreaterThan(-1);
  const end = css.indexOf('\n}', start);
  expect(end, '@theme block must be closed').toBeGreaterThan(start);
  return css.slice(start, end);
}

describe('display face', () => {
  it('loads Barlow Semi Condensed at 600 through next/font and hands it to CSS as a variable', () => {
    expect(layout).toContain(`import { ${FAMILY_IMPORT} } from 'next/font/google';`);

    const call = layout.match(new RegExp(`${FAMILY_IMPORT}\\(\\{([\\s\\S]*?)\\}\\)`));
    expect(call, `app/layout.tsx must call ${FAMILY_IMPORT}({ ... })`).not.toBeNull();
    const options = call![1];
    expect(options).toMatch(/weight:\s*'600'/);
    expect(options).toMatch(new RegExp(`variable:\\s*'${FONT_VARIABLE}'`));

    // The variable only exists on the page once the class is on <html>.
    expect(layout).toMatch(/<html[^>]*className=\{displayFace\.variable\}/);
  });

  it('maps --font-display to that variable with the body sans as the fallback', () => {
    const theme = themeBlock(globalsCss);
    const token = theme.match(/--font-display:\s*([^;]+);/);
    expect(token, '@theme must declare --font-display').not.toBeNull();
    const value = token![1].trim();
    expect(value.startsWith(`var(${FONT_VARIABLE})`)).toBe(true);
    expect(value).toContain('ui-sans-serif');
    // A generic `serif` or a named serif in the stack is the old fallback
    // creeping back; `sans-serif` at the end is the body stack and is right.
    expect(value).not.toMatch(/\bui-serif\b|\bGeorgia\b|(^|,)\s*serif\s*$/);
  });

  it('is worn by pageTitleClass and nowhere else in the app', () => {
    const pageTitle = pageHeader.match(/export const pageTitleClass =\s*'([^']+)'/);
    expect(pageTitle, 'page-header.tsx must export pageTitleClass').not.toBeNull();
    const classes = pageTitle![1].split(/\s+/);
    expect(classes).toContain('font-display');
    // The layout loads the 600 face only, so the title has to ASK for 600:
    // preflight sets headings to `font-weight: inherit`, and a 400 request
    // against a 600-only family renders through the browser's nearest-weight
    // fallback rather than by design.
    expect(classes).toContain('font-semibold');
    expect(classes).toContain('text-[2.25rem]');
    expect(classes).toContain('tracking-normal');
    expect(classes).toContain('text-ink');

    // Every other `font-display` in the codebase is the token in globals.css or
    // prose in the agent docs; a component spelling it directly has stepped
    // around pageTitleClass.
    const root = fileURLToPath(new URL('../../', import.meta.url));
    let hits = '';
    try {
      hits = execFileSync(
        'grep',
        ['-rln', '--include=*.tsx', '--include=*.ts', 'font-display', 'app', 'components', 'lib'],
        { cwd: root, encoding: 'utf8' },
      );
    } catch (error) {
      // grep exits 1 when nothing matches, which cannot happen here because
      // page-header.tsx matches; anything else is a real failure.
      const status = (error as { status?: number }).status;
      if (status !== 1) throw error;
    }
    const files = hits.split('\n').filter(Boolean).sort();
    expect(files).toEqual(['components/ui/page-header.tsx']);
  });
});
