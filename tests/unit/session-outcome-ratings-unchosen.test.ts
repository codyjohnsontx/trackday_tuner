import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/product-events.client', () => ({ trackProductEvent: vi.fn() }));

import { SessionOutcomePanel } from '@/components/sessions/session-outcome-panel';
import type { Session, SessionFeedback } from '@/types';

// The outcome panel's rating selects opened on 3 (confidence) and 4 (AI
// usefulness), and Save sent whatever they showed, so a rider who never touched
// them taught the recommendation learning loop a rating they had never given.
// The suite has no DOM, so this reads which option the first render selects.

const session = { id: 's2', vehicle_id: 'v1', track_name: 'Thunderhill', date: '2026-10-04' } as Session;
const reference = { id: 's1', vehicle_id: 'v1', track_name: 'Thunderhill', date: '2026-10-03' } as Session;

function renderPanel(existing: SessionFeedback | null): string {
  return renderToStaticMarkup(
    createElement(SessionOutcomePanel, {
      session,
      references: [reference],
      recommendations: [],
      existing,
      disabled: false,
    }),
  );
}

function selectedOption(html: string, label: string): string | undefined {
  const select = html.match(new RegExp(`${label}</span><select[\\s\\S]*?</select>`))?.[0];
  return select?.match(/<option[^>]*selected=""[^>]*>([^<]*)<\/option>/)?.[1];
}

describe('outcome panel ratings', () => {
  it('opens a new outcome with confidence unrated', () => {
    expect(selectedOption(renderPanel(null), 'Rider confidence')).toBe('Not rated');
  });

  it('still offers every rating', () => {
    const html = renderPanel(null);
    for (const value of ['1', '2', '3', '4', '5']) expect(html).toContain(`<option value="${value}">${value}</option>`);
  });
});
