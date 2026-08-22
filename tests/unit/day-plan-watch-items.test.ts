import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DayPlanAdviceResult, demoDayPlanAdvice } from '@/components/ai/day-plan-panel';
import { WatchItems } from '@/components/ai/watch-items';
import type { AdviceResponse } from '@/lib/rag/schema';

/**
 * `SYSTEM_PROMPT` tells the model to put things to watch rather than change in
 * `prediction.watch_items` (describeComponentVocabulary() in
 * lib/rag/component-vocabulary.ts), so a panel that prints only
 * `expected_effect` and `day_trend` discards exactly the content the prompt
 * asked for. Race Engineer rendered the list and the day plan did not, which is
 * the same omission-shaped bug that lifted RefusalCard and SafetyBanner into
 * shared components.
 *
 * The suite has no DOM, so this renders to static markup: structural evidence
 * that the strings reach the rider, not that they are legible on screen.
 */
function renderDayPlan(advice: AdviceResponse): string {
  return renderToStaticMarkup(createElement(DayPlanAdviceResult, { advice }));
}

describe('day plan watch items', () => {
  it('renders every watch item the demo plan carries', () => {
    const html = renderDayPlan(demoDayPlanAdvice);
    expect(demoDayPlanAdvice.prediction?.watch_items.length).toBeGreaterThan(0);
    for (const item of demoDayPlanAdvice.prediction?.watch_items ?? []) {
      expect(html).toContain(item);
    }
  });

  it('renders no list when there is nothing to watch', () => {
    const advice: AdviceResponse = {
      ...demoDayPlanAdvice,
      prediction: {
        expected_effect: 'Turn-in should stay where Session 3 left it.',
        day_trend: 'Cool and stable all day.',
        watch_items: [],
      },
    };
    const html = renderDayPlan(advice);
    expect(html).toContain('Cool and stable all day.');
    expect(html).not.toContain('<ul class="list-disc');
  });

  it('renders nothing at all for an empty list', () => {
    expect(renderToStaticMarkup(createElement(WatchItems, { items: [] }))).toBe('');
  });

  // The list was lifted out of the Race Engineer panel unchanged, so pinning the
  // markup here is what keeps that panel's rendering where it already was.
  it('emits the markup Race Engineer already showed', () => {
    expect(renderToStaticMarkup(createElement(WatchItems, { items: ['a', 'b'] }))).toBe(
      '<ul class="list-disc space-y-1 pl-5"><li>a</li><li>b</li></ul>',
    );
  });
});
