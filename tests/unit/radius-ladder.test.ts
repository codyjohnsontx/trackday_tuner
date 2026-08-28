import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards the radius ladder recorded in CLAUDE.md and in the `@theme` block of
// app/globals.css: card 10px, row 8px, plate 6px, control 6px, with the Button
// taking its shape from the `control` rung.
//
// The ladder is a look, and a look is the one thing a passing test suite cannot
// tell you about. So this guard is deliberately narrow: it locks the four
// numbers and the Button's rung, which is exactly the part a later restyle can
// drift back without anyone noticing. A card that reads mean beside a plate is
// still a question for a screenshot, not for this file.
//
// WHAT IT CATCHES:
//   - any of the four tokens changing value, or being deleted
//   - a fifth `--radius-*` token appearing without a decision being taken here,
//     which is what a magic number sneaking back into the ladder looks like
//   - the Button base class losing `rounded-control`, or any `rounded-full`
//     reaching the `cva` call on the base or on a variant - the exact
//     regression this change exists to undo, and one a base-only check misses
//
// WHAT IT DOES NOT CATCH, because a guard credited with more than it does is
// worse than none:
//   - a component hard-coding `rounded-[10px]` instead of using a token
//   - a `rounded-full` appearing on something that should join the ladder. That
//     is a per-site judgement (a nav pill and a status chip are round on
//     purpose, and both are annotated where they live), so it needs eyes rather
//     than a pattern
//   - any corner in components/ui/button.tsx outside the `cva` call. The Button
//     assertions read that call alone, so a round sub-element elsewhere in the
//     file is out of scope on purpose: app/globals.css reserves `rounded-full`
//     for the press ripple, which the Button owns and renders as a real circle
//   - anything about how the corners actually render. Only a browser answers
//     that, and the before/after screenshots on the pull request are that
//     evidence.

const globalsCss = readFileSync(
  fileURLToPath(new URL('../../app/globals.css', import.meta.url)),
  'utf8',
);

const buttonSource = readFileSync(
  fileURLToPath(new URL('../../components/ui/button.tsx', import.meta.url)),
  'utf8',
);

// The `@theme` block only - a `--radius-*` mentioned in prose further down the
// file is documentation, not a token.
function themeBlock(css: string): string {
  const start = css.indexOf('@theme {');
  expect(start, 'app/globals.css must declare an @theme block').toBeGreaterThan(-1);
  const end = css.indexOf('\n}', start);
  expect(end, '@theme block must be closed').toBeGreaterThan(start);
  return css.slice(start, end);
}

function radiusTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of themeBlock(css).matchAll(/--radius-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

// The Button's shape comes out of its `cva` call, so that call is the unit both
// assertions read - not the whole file, where a `rounded-control` in a comment
// could stand in for a base class that lost it and the press ripple's own
// `rounded-full` would read as the regression this guards against.
//
// The base class and the variants are read separately because they fail
// differently. The base must CARRY `rounded-control`. No variant may carry
// `rounded-full`, and that half is not cosmetic: `cn()` is `twMerge`, which does
// not know `rounded-control` belongs to the `rounded-*` group, so it keeps both
// classes instead of collapsing them (unlike `rounded-sm rounded-full`, which it
// does collapse). Tailwind then emits `.rounded-full` after `.rounded-control`,
// so at equal specificity the round one wins and the Button silently goes back
// to a pill. Checking only the base string would pass while that happened.
function cvaCall(source: string): string {
  const start = source.search(/\bcva\(/);
  expect(start, 'components/ui/button.tsx must call cva').toBeGreaterThan(-1);
  // Walk to the matching close paren so variant objects are included whole.
  let depth = 0;
  for (let i = source.indexOf('(', start); i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('components/ui/button.tsx has an unterminated cva( call');
}

function cvaBaseClass(source: string): string {
  const match = cvaCall(source).match(/\bcva\(\s*(['"`])((?:[^\\]|\\.)*?)\1/);
  expect(match, 'components/ui/button.tsx must pass cva a base class string').not.toBeNull();
  return (match as RegExpMatchArray)[2];
}

const EXPECTED_LADDER: ReadonlyArray<readonly [string, string]> = [
  ['card', '10px'],
  ['row', '8px'],
  ['plate', '6px'],
  ['control', '6px'],
];

describe('radius ladder', () => {
  const tokens = radiusTokens(globalsCss);

  it.each(EXPECTED_LADDER)('--radius-%s is %s', (rung, value) => {
    expect(tokens.get(rung)).toBe(value);
  });

  it('has exactly the four rungs and no others', () => {
    expect([...tokens.keys()].sort()).toEqual(
      EXPECTED_LADDER.map(([rung]) => rung).sort(),
    );
  });

  it('never widens going down the ladder', () => {
    const widths = EXPECTED_LADDER.map(([rung]) => {
      const value = tokens.get(rung);
      expect(value, `--radius-${rung} is missing`).toBeDefined();
      return Number.parseFloat(value as string);
    });

    for (let i = 1; i < widths.length; i += 1) {
      expect(
        widths[i],
        `--radius-${EXPECTED_LADDER[i][0]} must not be wider than --radius-${EXPECTED_LADDER[i - 1][0]}`,
      ).toBeLessThanOrEqual(widths[i - 1]);
    }
  });

  it('shapes the Button from the control rung, not from rounded-full', () => {
    expect(cvaBaseClass(buttonSource)).toContain('rounded-control');
  });

  it('lets no Button variant put a competing radius back on the base', () => {
    // Anywhere in the cva call, base or variant: twMerge keeps both classes and
    // the round one wins in the emitted CSS, so this must not be base-only.
    expect(cvaCall(buttonSource)).not.toContain('rounded-full');
  });
});
