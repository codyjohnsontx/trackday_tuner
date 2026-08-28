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
//   - the Button base class losing `rounded-control`, or `rounded-full`
//     appearing anywhere in components/ui/button.tsx - on the `cva` base, on a
//     variant, or in either `cn()` list that builds the rendered class string.
//     All three reach the rendered corner, and a check scoped any narrower
//     than the file misses the ones outside the `cva` parens
//
// WHAT IT DOES NOT CATCH, because a guard credited with more than it does is
// worse than none:
//   - a component hard-coding `rounded-[10px]` instead of using a token
//   - a `rounded-full` appearing on something that should join the ladder. That
//     is a per-site judgement (a nav pill and a status chip are round on
//     purpose, and both are annotated where they live), so it needs eyes rather
//     than a pattern
//   - a corner reaching the Button from outside its own file: a caller passing
//     `rounded-full` down through `className`, or an arbitrary
//     `rounded-[9999px]` in either spelling. The negative check reads
//     components/ui/button.tsx as text, so it sees only what that file spells
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

// The two Button assertions are scoped differently, because they fail
// differently.
//
// The POSITIVE half reads the `cva` base class alone: the base must CARRY
// `rounded-control`, and a whole-file `toContain` would be satisfied by the word
// sitting in a comment while the base class it stands for had lost it.
//
// The NEGATIVE half reads the WHOLE file, because nothing in
// components/ui/button.tsx legitimately needs `rounded-full` and so there is
// nothing there for it to collide with. The press ripple is a real circle, but
// its radius is `.tt-ripple { border-radius: 9999px }` in app/globals.css - the
// element here carries only the `tt-ripple` class, not a utility. Whole-file is
// also the only scope that holds: `rounded-full` reaches the rendered corner
// from the `cva` base, from a variant, or from either `cn()` list that composes
// the final class string, and `cn()` is `twMerge`, which does not know
// `rounded-control` belongs to the `rounded-*` group, so it keeps both classes
// instead of collapsing them (unlike `rounded-sm rounded-full`, which it does
// collapse). Tailwind then emits `.rounded-full` after `.rounded-control`, so at
// equal specificity the round one wins and the Button silently goes back to a
// pill. A check scoped to the base string, or to the `cva` call, passes while
// that happens.
function cvaBaseClass(source: string): string {
  const match = source.match(/\bcva\(\s*(['"`])((?:[^\\]|\\.)*?)\1/);
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

  it('lets nothing in the Button put a competing radius back on it', () => {
    // Anywhere in the file - cva base, variant, or either cn() list: twMerge
    // keeps both classes and the round one wins in the emitted CSS.
    expect(buttonSource).not.toContain('rounded-full');
  });
});
