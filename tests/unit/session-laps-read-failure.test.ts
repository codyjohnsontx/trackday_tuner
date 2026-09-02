import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The panel is the last place the two answers can still be told apart, so this
// renders it rather than testing around it. Importing it pulls in the server
// action module, which reaches next/cache and the Supabase server client; none
// of it runs during a render, and mocking the module keeps the import from
// loading it at all.
vi.mock('@/lib/actions/sessions', () => ({
  replaceSessionLaps: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { SessionLapsPanel } from '@/components/sessions/session-laps-panel';
import type { SessionLap } from '@/types';

/**
 * A rider whose laps could not be read used to be shown "Add Lap Times" - the
 * app telling them, in its own words, that a session holding twenty laps held
 * none. Retyping the five they remembered called `replace_session_laps`, which
 * deletes the whole set before inserting, so their own recovery destroyed the
 * other fifteen.
 *
 * `getSessionLaps` now reports the failure and the page passes it down as
 * `null`, and these lock the two ends of that apart: a failed read offers
 * nothing that saves, and a session that genuinely holds no laps still offers
 * the button it always did. The suite has no DOM, so this reads the rendered
 * markup - enough for the invariant, which is which controls exist.
 */

function laps(count: number): SessionLap[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `lap-${index + 1}`,
    user_id: 'user-1',
    session_id: 'sess-1',
    lap_number: index + 1,
    lap_time_ms: 101_000 + index,
    included: true,
    source: 'manual',
    created_at: '2026-08-30T09:00:00Z',
    updated_at: '2026-08-30T09:00:00Z',
  }));
}

function render(initialLaps: SessionLap[] | null): string {
  return renderToStaticMarkup(
    createElement(SessionLapsPanel, {
      sessionId: 'sess-1',
      vehicleId: 'veh-1',
      initialLaps,
      demoMode: false,
    }),
  );
}

describe('the lap panel when the laps could not be read', () => {
  it('offers nothing that would replace laps it never read', () => {
    const html = render(null);

    expect(html).not.toContain('Add Lap Times');
    expect(html).not.toContain('>Edit<');
    expect(html).not.toContain('Save laps');
  });

  it('says the read failed rather than that the session has no laps', () => {
    const html = render(null);

    expect(html).toContain('Lap times could not be loaded for this session.');
    expect(html).toContain('nothing already saved gets overwritten');
  });

  it('leaves the rider a way back once the failure clears', () => {
    expect(render(null)).toContain('Try again');
  });

  it('still offers Add Lap Times when the read succeeded and found none', () => {
    const html = render([]);

    expect(html).toContain('Add Lap Times');
    expect(html).not.toContain('could not be loaded');
  });

  it('offers Edit when the read succeeded and found laps', () => {
    const html = render(laps(4));

    expect(html).toContain('4 included laps');
    expect(html).toContain('Edit');
    expect(html).not.toContain('Add Lap Times');
  });
});
