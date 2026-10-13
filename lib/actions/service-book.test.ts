import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getRealUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/monitoring/report-error', () => ({ reportError: vi.fn() }));
vi.mock('@/lib/demo/mode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/demo/mode')>()),
  isDemoMode: vi.fn(async () => false),
  assertNotDemoMode: vi.fn(async () => null),
}));

import { getRealUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getServiceBookUnitLocked, updateServiceBookSettings } from '@/lib/actions/service-book';

/**
 * The distance unit of a book that already holds distances cannot change: the
 * numbers are stored in the book's unit and nothing converts them. The fake
 * answers each table with the rows the action's filters would leave, so a
 * table holding a distance answers with that row and an empty one with none.
 */

type Rows = Record<string, unknown[]>;

function clientWith(distanceRows: Rows, bookError: { message: string } | null = null) {
  const updates: unknown[] = [];
  const from = vi.fn((table: string) => {
    let update: unknown = null;
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'not', 'or', 'limit']) query[method] = vi.fn(() => query);
    query.update = vi.fn((change: unknown) => {
      update = change;
      return query;
    });
    query.maybeSingle = vi.fn(async () => {
      if (table === 'vehicles') return { data: { id: 'veh-1', user_id: 'rider-1' }, error: null };
      if (table === 'service_books') {
        return bookError ? { data: null, error: bookError } : { data: { id: 'book-1', vehicle_id: 'veh-1', distance_unit: 'mi' }, error: null };
      }
      return { data: null, error: null };
    });
    query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
      if (update !== null) updates.push(update);
      const result = update !== null ? { data: null, error: null } : { data: distanceRows[table] ?? [], error: null };
      return Promise.resolve(result).then(onFulfilled, onRejected);
    };
    return query;
  });
  return { client: { from }, updates };
}

const switchToKm = {
  tracks_hours: true,
  tracks_distance: true,
  distance_unit: 'km' as const,
  default_session_minutes: 20,
  default_session_distance: null,
};

describe('updateServiceBookSettings and the distance unit', () => {
  beforeEach(() => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'rider-1' } as Awaited<ReturnType<typeof getRealUser>>);
  });

  for (const [table, row] of [
    ['vehicle_readings', { distance: 1240 }],
    ['service_entries', { reading_distance: 1180 }],
    ['service_items', { interval_distance: 3000 }],
    ['service_due_overrides', { until_distance: null, anchor_distance: 900 }],
    ['session_usage_weights', { distance_override: 40 }],
  ] as const) {
    it(`refuses a switch while ${table} holds a distance, and writes nothing`, async () => {
      const { client, updates } = clientWith({ [table]: [row] });
      vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await updateServiceBookSettings('veh-1', switchToKm);

      expect(result).toEqual({
        ok: false,
        error: 'This book already holds distances in miles, so its unit stays miles. Switching would relabel them without converting.',
      });
      expect(updates).toEqual([]);
    });
  }

  it('switches a book that holds no distance', async () => {
    const { client, updates } = clientWith({});
    vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);

    const result = await updateServiceBookSettings('veh-1', switchToKm);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(updates).toEqual([expect.objectContaining({ distance_unit: 'km' })]);
  });
});

describe('getServiceBookUnitLocked, the lock the settings screen shows', () => {
  beforeEach(() => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'rider-1' } as Awaited<ReturnType<typeof getRealUser>>);
  });

  it('is locked by an entry reading the book still holds, removed entries included', async () => {
    const { client } = clientWith({ service_entries: [{ id: 'removed-entry' }] });
    vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);

    expect(await getServiceBookUnitLocked('veh-1')).toEqual({ ok: true, data: true });
  });

  it('is open on a book that holds no distance', async () => {
    const { client } = clientWith({});
    vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);

    expect(await getServiceBookUnitLocked('veh-1')).toEqual({ ok: true, data: false });
  });

  it('reports a failed book read as a read failure, not a save failure', async () => {
    const { client } = clientWith({}, { message: 'connection reset' });
    vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);

    expect(await getServiceBookUnitLocked('veh-1')).toEqual({ ok: false, error: 'The service book could not be read. Try again.' });
  });
});
