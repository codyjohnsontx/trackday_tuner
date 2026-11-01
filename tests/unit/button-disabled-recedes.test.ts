import { describe, expect, it } from 'vitest';
import { buttonVariants } from '@/components/ui/button';

// A disabled primary button recedes to a surface fill with muted text rather
// than dimming the white pill. Sixty percent of white on the near-black canvas
// was still the brightest thing on the page, so a disabled Download CSV, Set
// as Vehicle Baseline or Add Vehicle pulled the eye to the one control that
// did nothing. The decision lives on the `primary` variant in
// components/ui/button.tsx; this locks the class list so a later restyle
// cannot drift it back to an opacity dim.
//
// It reads the `cva` output, not a rendered colour. Whether the result still
// reads as a button, and whether the eye lands elsewhere first, is a screenshot
// question - the before/after pair on the pull request is that evidence.

describe('primary button disabled treatment', () => {
  const primary = buttonVariants({ variant: 'primary' }).split(/\s+/);

  it('recedes to a surface fill with muted text', () => {
    expect(primary).toContain('disabled:bg-surface-3');
    expect(primary).toContain('disabled:text-ink-faint');
  });

  it('does not dim the white pill', () => {
    expect(primary.filter((cls) => cls.startsWith('disabled:opacity'))).toEqual([]);
  });

  it('keeps the enabled fill and the focus ring', () => {
    expect(primary).toContain('bg-ink');
    expect(primary).toContain('text-canvas');
    expect(primary).toContain('focus-visible:ring-2');
    expect(primary).toContain('focus-visible:ring-signal/80');
  });

  it('leaves the dark variants dimming, since dimming is what recedes on them', () => {
    for (const variant of ['secondary', 'ghost', 'destructive'] as const) {
      expect(buttonVariants({ variant }).split(/\s+/)).toContain('disabled:opacity-60');
    }
  });
});
