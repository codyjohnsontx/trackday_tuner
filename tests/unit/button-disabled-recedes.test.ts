import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';

// A disabled primary button recedes to a surface fill with muted text rather
// than dimming the white pill. Sixty percent of white on the near-black canvas
// was still the brightest thing on the page, so a disabled Download CSV, Set
// as Vehicle Baseline or Add Vehicle pulled the eye to the one control that
// did nothing.
//
// This renders a real <Button>, compiles app/globals.css through Tailwind with
// the classes it carries, and resolves the cascade for the state the button is
// in, the way tests/unit/display-face.test.ts reads the page-title face. So a
// class that never compiles, or a disabled fill that loses to the hover fill,
// fails here.
//
// WHAT IT DOES NOT CATCH: whether the result still reads as a button, and
// whether the eye lands elsewhere first. That is a screenshot question - the
// before/after pair on the pull request is that evidence.

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

interface CssNode {
  prelude: string;
  decls: Array<[string, string]>;
  children: CssNode[];
}

function parseBlock(css: string): CssNode {
  const top: CssNode = { prelude: '', decls: [], children: [] };
  const stack = [top];
  let buffer = '';
  const flush = () => {
    const text = buffer.trim();
    buffer = '';
    const colon = text.indexOf(':');
    if (colon > 0) stack.at(-1)!.decls.push([text.slice(0, colon).trim(), text.slice(colon + 1).trim()]);
  };
  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (char === '{') {
      const node: CssNode = { prelude: buffer.trim(), decls: [], children: [] };
      buffer = '';
      stack.at(-1)!.children.push(node);
      stack.push(node);
    } else if (char === ';') {
      flush();
    } else if (char === '}') {
      flush();
      stack.pop();
    } else {
      buffer += char;
    }
  }
  return top;
}

interface Rule {
  className: string;
  pseudos: string[];
  conditions: string[];
  property: string;
  value: string;
  order: number;
}

function utilityRules(css: string): Rule[] {
  const layer = parseBlock(css).children.find((node) => node.prelude === '@layer utilities');
  expect(layer, 'the compiled stylesheet must have a utilities layer').toBeDefined();
  const rules: Rule[] = [];
  const walk = (node: CssNode, className: string, pseudos: string[], conditions: string[]) => {
    for (const [property, value] of node.decls) {
      rules.push({ className, pseudos, conditions, property, value, order: rules.length });
    }
    for (const child of node.children) {
      if (child.prelude.startsWith('&')) walk(child, className, [...pseudos, child.prelude.slice(1)], conditions);
      else walk(child, className, pseudos, [...conditions, child.prelude]);
    }
  };
  for (const node of layer!.children) {
    if (node.prelude.startsWith('.')) walk(node, node.prelude.slice(1).replace(/\\(.)/g, '$1'), [], []);
  }
  return rules;
}

// A pointer-capable screen with color-mix support, so `hover:` and the
// `@supports` fallbacks apply as they do on a desktop browser.
function conditionHolds(condition: string): boolean {
  return condition === '@media (hover: hover)' || condition.startsWith('@supports');
}

// The winning value of `property` on an element carrying `classes` in the
// given pseudo-class states: highest specificity first, then source order.
function computed(rules: Rule[], classes: string[], states: string[], property: string): string | undefined {
  const winner = rules
    .filter(
      (rule) =>
        rule.property === property &&
        classes.includes(rule.className) &&
        rule.pseudos.every((pseudo) => states.includes(pseudo)) &&
        rule.conditions.every(conditionHolds),
    )
    .sort((a, b) => a.pseudos.length - b.pseudos.length || a.order - b.order)
    .at(-1);
  return winner?.value;
}

function themeValue(css: string, variable: string): string | undefined {
  const theme = css.match(/:root, :host\s*\{([^}]*)\}/)?.[1];
  return theme?.match(new RegExp(`(?:^|[;\\s])${variable}:\\s*([^;]+);`))?.[1].trim();
}

interface RenderedButton {
  classes: string[];
  disabled: boolean;
}

function renderButton(props: Parameters<typeof Button>[0]): RenderedButton {
  const html = renderToStaticMarkup(createElement(Button, props));
  const tag = html.match(/<button([^>]*)>/)?.[1];
  expect(tag, 'Button must render a <button>').toBeDefined();
  return {
    classes: tag!.match(/\bclass="([^"]*)"/)![1].split(/\s+/),
    disabled: /\sdisabled=""/.test(tag!),
  };
}

async function styleOf(button: RenderedButton) {
  const css = await compileGlobals(button.classes);
  const rules = utilityRules(css);
  return {
    css,
    get: (states: string[], property: string) =>
      computed(rules, button.classes, button.disabled ? [':disabled', ...states] : states, property),
  };
}

describe('primary button disabled treatment', () => {
  it('recedes to a surface fill with muted text, and does not dim', async () => {
    const button = renderButton({ disabled: true, children: 'Download CSV' });
    expect(button.disabled).toBe(true);
    const style = await styleOf(button);

    expect(style.get([], 'background-color')).toBe('var(--color-surface-3)');
    expect(style.get([], 'color')).toBe('var(--color-ink-faint)');
    expect(style.get([], 'opacity')).toBeUndefined();
    expect(themeValue(style.css, '--color-surface-3')).toBeDefined();
    expect(themeValue(style.css, '--color-ink-faint')).toBeDefined();
  });

  it('keeps the surface fill under a hovering pointer', async () => {
    const style = await styleOf(renderButton({ disabled: true, children: 'Add Vehicle' }));
    expect(style.get([':hover'], 'background-color')).toBe('var(--color-surface-3)');
  });

  it('leaves the enabled fill, hover and focus ring as they were', async () => {
    const button = renderButton({ children: 'Add Vehicle' });
    expect(button.disabled).toBe(false);
    const style = await styleOf(button);

    expect(style.get([], 'background-color')).toBe('var(--color-ink)');
    expect(style.get([], 'color')).toBe('var(--color-canvas)');
    expect(style.get([], 'opacity')).toBeUndefined();
    expect(style.get([':hover'], 'background-color')).toBe('var(--color-white)');
    expect(style.get([':focus-visible'], 'box-shadow')).toContain('var(--tw-ring-shadow)');
    expect(style.get([':focus-visible'], '--tw-ring-shadow')).toContain('calc(2px');
    expect(style.get([':focus-visible'], '--tw-ring-color')).toContain('var(--color-signal)');
  });

  it('leaves the dark variants dimming, since dimming is what recedes on them', async () => {
    for (const variant of ['secondary', 'ghost', 'destructive'] as const) {
      const style = await styleOf(renderButton({ variant, disabled: true, children: 'Cancel' }));
      expect(style.get([], 'opacity'), variant).toBe('60%');
    }
  });
});
