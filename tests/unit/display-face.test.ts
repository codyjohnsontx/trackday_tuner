import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { PageHeader } from '@/components/ui/page-header';

// Guards the page-title face recorded in CLAUDE.md ("Type"): a page title
// rendered by `PageHeader` has to come out of the real stylesheet as Barlow
// Semi Condensed 600, the face app/layout.tsx loads into
// `--font-barlow-semi-condensed`.
//
// Nothing else checks that chain: the `@theme` token happily names a CSS
// variable nothing sets, and the utility happily falls through to the fallback
// stack with no build warning, so every title would quietly render in the
// system sans. This renders the title, compiles app/globals.css through
// Tailwind with the classes the title actually carries, and reads the emitted
// CSS.
//
// WHAT IT CATCHES:
//   - the title losing the display face or the 600 weight the layout loads
//   - `--font-display` no longer starting from the layout's variable, or its
//     fallback stack drifting back to a serif
//
// WHAT IT DOES NOT CATCH: app/layout.tsx loading a different family under that
// variable, or the font file failing to load. next/font only runs inside a Next
// build, so that is a browser question, answered by the screenshots on the
// pull request.

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);

async function compileGlobals(candidates: string[]): Promise<string> {
  const cssPath = path.join(root, 'app/globals.css');
  const compiler = await compile(await readFile(cssPath, 'utf8'), {
    base: path.dirname(cssPath),
    loadStylesheet: async (id, base) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : path.resolve(base, id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  return compiler.build(candidates);
}

function declaration(css: string, selector: string, property: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return rule?.[1].match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`))?.[1].trim();
}

function titleClasses(): string[] {
  const html = renderToStaticMarkup(createElement(PageHeader, { title: 'Dashboard' }));
  const h1 = html.match(/<h1 class="([^"]*)">Dashboard<\/h1>/);
  expect(h1, 'PageHeader must render the title in an <h1>').not.toBeNull();
  return h1![1].split(/\s+/);
}

describe('display face', () => {
  it('renders a page title in Barlow Semi Condensed at 600', async () => {
    const classes = titleClasses();
    const css = await compileGlobals(classes);

    const family = classes
      .map((name) => declaration(css, `.${name}`, 'font-family'))
      .filter((value): value is string => value !== undefined);
    expect(family).toEqual(['var(--font-display)']);

    // The layout loads the 600 face only, so the title has to ASK for 600:
    // preflight sets headings to `font-weight: inherit`, and any other request
    // renders through the browser's nearest-weight fallback.
    const weight = classes
      .map((name) => declaration(css, `.${name}`, 'font-weight'))
      .filter((value): value is string => value !== undefined);
    expect(weight).toEqual(['var(--font-weight-semibold)']);
    expect(declaration(css, ':root, :host', '--font-weight-semibold')).toBe('600');

    const display = declaration(css, ':root, :host', '--font-display');
    expect(display, 'the compiled theme must define --font-display').toBeDefined();
    const stack = display!.split(',').map((entry) => entry.trim());
    expect(stack[0]).toBe('var(--font-barlow-semi-condensed)');
    // A title that fails to load falls back to the body sans, never a serif.
    expect(stack.at(-1)).toBe('sans-serif');
    expect(stack).not.toContain('serif');
    expect(stack).not.toContain('ui-serif');
  });
});
