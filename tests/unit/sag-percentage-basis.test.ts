import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SagSection, type SagSectionValues } from '@/components/sag/sag-section';

// The Sag calculator divided sag by L0 to produce its percentage. L0 is the
// distance between two arbitrary reference points (axle to a mark on the tail),
// not suspension travel, so the result looked like the industry-standard figure
// riders use to pick a spring rate and was not one.
//
// A rear with 35mm of rider sag on a bike with 120mm of travel is at 29.2% -
// just under the usual 30-33% target band, so the spring is about right. The
// old code reported 5.7%, off by a factor of five and in a direction that reads
// as drastically under-sagged. A rider acting on that fits a far softer spring
// than they need.
//
// `sag_entries` has carried `front_travel_mm` / `rear_travel_mm` since it was
// created and `createSagEntry` has always written them; nothing in the UI ever
// collected the number, so every saved row stored null.
//
// The suite is node-only with no DOM renderer, so this renders to static markup
// and reads the text back. The percentage arithmetic is the invariant.

function render(values: Partial<SagSectionValues>): string {
  return renderToStaticMarkup(
    createElement(SagSection, {
      title: 'Rear',
      values: { l0: '', l1: '', l2: '', travel: '', ...values },
      onChange: () => {},
    }),
  );
}

/**
 * The rendered result rows, as `label -> value`. Reading whole cells rather than
 * searching the markup keeps `2.5%` from matching inside `12.5%`.
 */
function results(html: string): Record<string, string> {
  const rows: Record<string, string> = {};
  const cell = /<span class="text-sm text-ink-dim">([^<]*)<\/span><span class="text-sm font-semibold text-ink">([^<]*)<\/span>/g;
  for (const [, label, value] of html.matchAll(cell)) {
    rows[label] = value;
  }
  return rows;
}

// Rear reference points 610/595/575 with 120mm of travel: free sag 15mm, rider
// sag 35mm. Against travel that is 12.5% and 29.2%; against L0 it would have
// been 2.5% and 5.7%.
const measured: SagSectionValues = { l0: '610', l1: '595', l2: '575', travel: '120' };

describe('sag percentage basis', () => {
  it('divides sag by total travel, not by L0', () => {
    const rows = results(render(measured));

    // 35/120, not 35/610 (which would have read 5.7%).
    expect(rows['Rider Sag (% of travel)']).toBe('29.2%');
    // 15/120, not 15/610 (which would have read 2.5%).
    expect(rows['Free Sag (% of travel)']).toBe('12.5%');
  });

  it('labels the percentage as being of travel', () => {
    const rows = results(render(measured));

    expect(Object.keys(rows)).toContain('Rider Sag (% of travel)');
    expect(Object.keys(rows)).not.toContain('Rider Sag (% of L0)');
  });

  it('still reports sag in millimeters without travel', () => {
    const rows = results(render({ ...measured, travel: '' }));

    expect(rows['Free/Static Sag']).toBe('15.0 mm');
    expect(rows['Rider/Race Sag']).toBe('35.0 mm');
  });

  it('shows no percentage at all when travel is unknown', () => {
    const html = render({ ...measured, travel: '' });

    expect(Object.values(results(html)).filter((v) => v.endsWith('%'))).toEqual([]);
    expect(html).toContain('Add total travel above to see sag as a percentage.');
  });

  it('shows no percentage and keeps the hint when travel is zero', () => {
    const html = render({ ...measured, travel: '0' });

    expect(Object.values(results(html)).filter((v) => v.endsWith('%'))).toEqual([]);
    expect(html).toContain('Add total travel above to see sag as a percentage.');
  });

  it('shows no percentage and keeps the hint when travel is negative', () => {
    const html = render({ ...measured, travel: '-120' });

    expect(Object.values(results(html)).filter((v) => v.endsWith('%'))).toEqual([]);
    expect(html).toContain('Add total travel above to see sag as a percentage.');
  });

  // Travel is the divisor for both percentages, so zero or negative is not a
  // small travel figure - it is not a usable number at all. The section used to
  // fall straight through to the sag comparison and announce "Rider sag exceeds
  // total travel", which names a problem the rider does not have and hides the
  // one they do, while calcSagPct and the percentage hint were both already
  // treating the value as unusable.
  it('names the travel figure as the problem when it is zero, not the sag', () => {
    const html = render({ ...measured, travel: '0' });

    expect(html).toContain('Total travel must be greater than zero.');
    expect(html).not.toContain('exceeds total travel');
  });

  it('names the travel figure as the problem when it is negative, not the sag', () => {
    const html = render({ ...measured, travel: '-120' });

    expect(html).toContain('Total travel must be greater than zero.');
    expect(html).not.toContain('exceeds total travel');
  });

  it('marks the travel field itself invalid rather than floating the message', () => {
    // Field-level validation belongs on the field: aria-invalid is what tells a
    // screen reader which of the four inputs is the one to go back to.
    expect(render({ ...measured, travel: '0' })).toContain('aria-invalid="true"');
    expect(render(measured)).not.toContain('aria-invalid="true"');
  });

  it('still compares sag against a usable travel figure', () => {
    // The new guard runs before the comparison, so it must not swallow it.
    expect(render({ ...measured, travel: '30' })).toContain(
      'Rider sag exceeds total travel. Recheck values.',
    );
  });

  it('collects total travel as its own field', () => {
    expect(render({})).toContain('Total Travel (optional)');
  });

  it('warns when rider sag exceeds total travel', () => {
    const html = render({ ...measured, travel: '30' });

    expect(html).toContain('Rider sag exceeds total travel. Recheck values.');
  });

  it('does not warn when rider sag fits inside travel', () => {
    expect(render(measured)).not.toContain('Rider sag exceeds total travel');
  });

  it('warns when free sag exceeds total travel', () => {
    const html = render({ l0: '610', l1: '480', l2: '600', travel: '120' });

    expect(html).toContain('Free sag exceeds total travel. Recheck values.');
  });

  it('does not warn when free sag fits inside travel', () => {
    expect(render(measured)).not.toContain('Free sag exceeds total travel');
  });
});
