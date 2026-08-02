import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards the cascade-layer invariant recorded in CLAUDE.md: every rule in
// app/globals.css must sit inside a layer.
//
// This is a static check on purpose. The root cause of the invisible-CTA bug was
// not "contrast is bad", it was structural - an unlayered rule outbidding every
// Tailwind utility regardless of specificity. That condition is readable straight
// off the stylesheet, so it needs no browser and costs nothing per pull request.
//
// LIMITATION, stated plainly because a guard assumed to cover more than it does is
// worse than none: this catches a rule being reintroduced outside a cascade layer
// in app/globals.css, and nothing else. It does NOT catch a contrast regression
// arriving any other way - a changed design token, an edited Button variant, or a
// new component pairing the wrong ink on the wrong fill. The computed-colour
// assertion in tests/e2e/auth-and-sag.spec.ts covers the rendered effect, but that
// suite is manual and does not gate pull requests. Neither guard replaces looking
// at the screen.

const GLOBALS_CSS_PATH = fileURLToPath(new URL('../../app/globals.css', import.meta.url));

// Allowed at the top level. `@import` pulls Tailwind in and `@theme` carries
// custom-property declarations rather than style rules, so neither can outrank a
// utility. Everything else must be inside a layer, which is why this list is a
// closed allowlist rather than a blocklist of known-bad at-rules.
const TOP_LEVEL_ALLOWED = ['@import', '@theme', '@layer'];

type TopLevelConstruct = {
  prelude: string;
  line: number;
};

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
}

function readConstruct(source: string, start: number, end: number): TopLevelConstruct {
  const raw = source.slice(start, end);
  const leadingWhitespace = raw.length - raw.trimStart().length;
  const line = source.slice(0, start + leadingWhitespace).split('\n').length;
  return { prelude: raw.trim().replace(/\s+/g, ' '), line };
}

// Walks the stylesheet tracking brace depth and collects every construct that
// opens at depth 0, whether it is a block (`selector { ... }`) or a statement
// (`@import ...;`). Quoted strings are skipped so a brace or semicolon inside one
// cannot shift the depth count.
function findTopLevelConstructs(css: string): TopLevelConstruct[] {
  const source = stripComments(css);
  const constructs: TopLevelConstruct[] = [];
  let depth = 0;
  let preludeStart = 0;
  let quote: string | null = null;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quote !== null) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '{') {
      if (depth === 0) constructs.push(readConstruct(source, preludeStart, i));
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) preludeStart = i + 1;
      continue;
    }

    if (char === ';' && depth === 0) {
      constructs.push(readConstruct(source, preludeStart, i));
      preludeStart = i + 1;
    }
  }

  return constructs;
}

function isAllowedAtTopLevel(prelude: string): boolean {
  return TOP_LEVEL_ALLOWED.some(
    (atRule) => prelude === atRule || prelude.startsWith(`${atRule} `) || prelude.startsWith(`${atRule}(`),
  );
}

function findUnlayeredRules(css: string): TopLevelConstruct[] {
  return findTopLevelConstructs(css).filter(
    (construct) => construct.prelude.length > 0 && !isAllowedAtTopLevel(construct.prelude),
  );
}

function explainViolations(violations: TopLevelConstruct[]): string {
  return [
    `app/globals.css has ${violations.length} rule(s) outside a cascade layer:`,
    ...violations.map((violation) => `  line ${violation.line}: ${violation.prelude} { ... }`),
    '',
    'Why this matters, because the failure is silent otherwise:',
    'Tailwind v4 emits every utility inside `@layer utilities`, and unlayered CSS',
    'beats layered CSS at any specificity. So one unlayered rule outranks a whole',
    'family of utilities while the build, the linter, and the types all stay green.',
    '',
    'This already shipped once. An unlayered `a { color: inherit }` outranked',
    '`text-canvas` on every anchor in the app, so the primary CTA rendered as white',
    'text on a white pill - #f4f4f5 on #f4f4f5, contrast 1.00:1, invisible.',
    '',
    'Fix: wrap the rule in `@layer base` if it is an element default, or',
    '`@layer components` if it is a helper class. Put `@keyframes` and `@media`',
    'blocks inside the layer holding the classes that consume them.',
  ].join('\n');
}

const PASSING_FIXTURE = `
@import "tailwindcss";

@theme {
  --color-canvas: #08080a;
}

@layer base {
  a {
    color: inherit;
  }
}

@layer components {
  @keyframes tt-pop {
    from { opacity: 0; }
  }

  .tt-pop {
    animation: tt-pop 0.4s ease-out;
  }

  @media (prefers-reduced-motion: reduce) {
    .tt-pop { animation: none; }
  }
}
`;

// The exact shape this branch fixed: element defaults and motion keyframes sitting
// at the top level, where they outrank every utility.
const FAILING_FIXTURE = `
@import "tailwindcss";

a {
  color: inherit;
}

@keyframes tt-pop {
  from { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .tt-pop { animation: none; }
}
`;

describe('app/globals.css cascade layers', () => {
  const css = readFileSync(GLOBALS_CSS_PATH, 'utf8');

  it('keeps every rule inside a cascade layer', () => {
    const violations = findUnlayeredRules(css);
    expect(violations, explainViolations(violations)).toEqual([]);
  });

  it('parses the real stylesheet rather than passing vacuously', () => {
    const preludes = findTopLevelConstructs(css).map((construct) => construct.prelude);

    expect(preludes).toContain('@import "tailwindcss"');
    expect(preludes).toContain('@theme');
    expect(preludes.filter((prelude) => prelude.startsWith('@layer '))).toEqual([
      '@layer base',
      '@layer components',
    ]);
  });

  it('keeps the element defaults and the motion keyframes layered', () => {
    expect(css).toMatch(/@layer base\s*\{[\s\S]*\ba\s*\{\s*color:\s*inherit/);
    expect(css).toMatch(/@layer components\s*\{[\s\S]*@keyframes tt-ripple-grow/);
    expect(css).toMatch(/@layer components\s*\{[\s\S]*@keyframes tt-btn-pop/);
  });
});

describe('unlayered-rule detection', () => {
  it('accepts a stylesheet whose rules are all layered', () => {
    expect(findUnlayeredRules(PASSING_FIXTURE)).toEqual([]);
  });

  it('flags bare selectors, keyframes, and media blocks at the top level', () => {
    expect(findUnlayeredRules(FAILING_FIXTURE).map((violation) => violation.prelude)).toEqual([
      'a',
      '@keyframes tt-pop',
      '@media (prefers-reduced-motion: reduce)',
    ]);
  });

  it('is not fooled by braces or selectors inside comments', () => {
    const css = `
/* An unlayered a { color: inherit } used to outrank text-canvas. */
@layer base {
  a { color: inherit; }
}
`;
    expect(findUnlayeredRules(css)).toEqual([]);
  });

  it('names the mechanism, the consequence, and the fix when it fails', () => {
    const message = explainViolations(findUnlayeredRules(FAILING_FIXTURE));

    expect(message).toContain('@layer utilities');
    expect(message).toContain('1.00:1');
    expect(message).toContain('@layer base');
    expect(message).toContain('@keyframes tt-pop { ... }');
  });
});
