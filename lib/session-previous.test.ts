import { describe, expect, it, vi } from 'vitest';
import { PREVIOUS_SESSION_SCAN_LIMIT, fetchPreviousSession } from '@/lib/session-previous';
import type { Session } from '@/types';

const baseSession: Session = {
  id: 'session-1',
  user_id: 'user-1',
  vehicle_id: 'vehicle-1',
  track_id: 'track-1',
  track_name: 'MSR Cresson',
  date: '2026-02-24',
  start_time: null,
  session_number: 1,
  conditions: 'sunny',
  tires: {
    condition: 'scrubbed',
    front: { brand: 'Pirelli', compound: 'SC1', pressure: '33 psi' },
    rear: { brand: 'Pirelli', compound: 'SC2', pressure: '26 psi' },
  },
  suspension: {
    front: { preload: '5 turns', compression: '12 clicks', rebound: '10 clicks', direction: 'out' },
    rear: { preload: '8 mm', compression: '11 clicks', rebound: '12 clicks', direction: 'out' },
  },
  alignment: null,
  enabled_modules: null,
  extra_modules: null,
  notes: null,
  created_at: '2026-02-24T14:00:00Z',
  updated_at: '2026-02-24T14:00:00Z',
};

function session(overrides: Partial<Session> = {}): Session {
  return { ...baseSession, ...overrides };
}

interface StubResponse {
  data: Session[] | null;
  error?: { message: string } | null;
}

/**
 * Minimal PostgREST builder stub. Records which range filter each query used so the
 * tests can tell the primary window apart from the earlier-date fallback.
 */
function createSupabaseStub(responses: StubResponse[]) {
  const rangeFilters: { method: 'lt' | 'lte'; column: string; value: unknown }[] = [];
  let queryCount = 0;

  const from = vi.fn(() => {
    const response = responses[queryCount] ?? { data: [], error: null };
    queryCount += 1;

    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'neq', 'order'] as const) {
      query[method] = vi.fn(() => query);
    }
    for (const method of ['lt', 'lte'] as const) {
      query[method] = vi.fn((column: string, value: unknown) => {
        rangeFilters.push({ method, column, value });
        return query;
      });
    }
    query.limit = vi.fn(async () => ({ data: response.data, error: response.error ?? null }));

    return query;
  });

  return {
    supabase: { from } as unknown as Parameters<typeof fetchPreviousSession>[0],
    rangeFilters,
    queryCount: () => queryCount,
  };
}

describe('fetchPreviousSession', () => {
  it('finds an earlier same-day session that has no start time', async () => {
    // The regression: `start_time.lt.<t>` skipped this row entirely, because
    // `NULL < '23:59:59'` is NULL rather than true.
    const earlier = session({ id: 'earlier', start_time: null, created_at: '2026-02-24T10:00:00Z' });
    const current = session({ id: 'current', start_time: null, created_at: '2026-02-24T14:00:00Z' });

    const { supabase } = createSupabaseStub([{ data: [current, earlier] }]);

    expect(await fetchPreviousSession(supabase, 'user-1', current)).toEqual(earlier);
  });

  it('treats a missing start time as the earliest time of the day', async () => {
    const noStartTime = session({ id: 'no-start', start_time: null, created_at: '2026-02-24T08:00:00Z' });
    const timed = session({ id: 'timed', start_time: '11:30:00', created_at: '2026-02-24T11:30:00Z' });
    const current = session({ id: 'current', start_time: '14:20:00', created_at: '2026-02-24T14:20:00Z' });

    const { supabase } = createSupabaseStub([{ data: [current, timed, noStartTime] }]);

    // Both are earlier, but the timed one is the immediate predecessor.
    expect(await fetchPreviousSession(supabase, 'user-1', current)).toEqual(timed);
  });

  it('ignores sessions that are not strictly before the current one', async () => {
    const later = session({ id: 'later', start_time: null, created_at: '2026-02-24T16:00:00Z' });
    const current = session({ id: 'current', start_time: null, created_at: '2026-02-24T14:00:00Z' });

    const { supabase } = createSupabaseStub([{ data: [later, current] }]);

    expect(await fetchPreviousSession(supabase, 'user-1', current)).toBeNull();
  });

  it('scopes the first query to the current date and earlier', async () => {
    const current = session({ id: 'current' });
    const { supabase, rangeFilters, queryCount } = createSupabaseStub([{ data: [] }]);

    await fetchPreviousSession(supabase, 'user-1', current);

    expect(queryCount()).toBe(1);
    expect(rangeFilters).toEqual([{ method: 'lte', column: 'date', value: '2026-02-24' }]);
  });

  it('falls back to an earlier-date query when the window fills with later same-day rows', async () => {
    const current = session({ id: 'current', start_time: null, created_at: '2026-02-24T06:00:00Z' });
    const sameDayAfter = Array.from({ length: PREVIOUS_SESSION_SCAN_LIMIT }, (_, index) =>
      session({
        id: `after-${index}`,
        start_time: null,
        created_at: `2026-02-24T23:00:${String(index).padStart(2, '0')}Z`,
      }),
    );
    const earlierDate = session({ id: 'earlier-date', date: '2026-02-23', created_at: '2026-02-23T15:00:00Z' });

    const { supabase, rangeFilters, queryCount } = createSupabaseStub([
      { data: sameDayAfter },
      { data: [earlierDate] },
    ]);

    expect(await fetchPreviousSession(supabase, 'user-1', current)).toEqual(earlierDate);
    expect(queryCount()).toBe(2);
    expect(rangeFilters).toEqual([
      { method: 'lte', column: 'date', value: '2026-02-24' },
      { method: 'lt', column: 'date', value: '2026-02-24' },
    ]);
  });

  it('does not run the fallback query when the window was not full', async () => {
    const current = session({ id: 'current', start_time: null, created_at: '2026-02-24T06:00:00Z' });
    const later = session({ id: 'later', start_time: null, created_at: '2026-02-24T18:00:00Z' });

    const { supabase, queryCount } = createSupabaseStub([{ data: [later] }, { data: [session({ id: 'unused' })] }]);

    expect(await fetchPreviousSession(supabase, 'user-1', current)).toBeNull();
    expect(queryCount()).toBe(1);
  });

  it('returns null when the query fails', async () => {
    const current = session({ id: 'current' });
    const { supabase } = createSupabaseStub([{ data: null, error: { message: 'boom' } }]);

    expect(await fetchPreviousSession(supabase, 'user-1', current)).toBeNull();
  });
});
