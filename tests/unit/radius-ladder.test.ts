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
//   - the Button base class losing `rounded-control`, or going back to
//     `rounded-full` - the exact regression this change exists to undo
//
// WHAT IT DOES NOT CATCH, because a guard credited with more than it does is
// worse than none:
//   - a component hard-coding `rounded-[10px]` instead of using a token
//   - a `rounded-full` appearing on something that should join the ladder. That
//     is a per-site judgement (a nav pill and a status chip are round on
//     purpose, and both are annotated where they live), so it needs eyes rather
//     than a pattern
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
    expect(buttonSource).toContain('rounded-control');
    expect(buttonSource).not.toContain('rounded-full');
  });
});
