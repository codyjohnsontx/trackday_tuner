import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getRealUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/monitoring/report-error', () => ({
  reportError: vi.fn(),
}));

import { revalidatePath } from 'next/cache';
import { getRealUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { reportError } from '@/lib/monitoring/report-error';
import { createVehicle, deleteVehicle, getVehicleDeletionCounts, updateVehicle } from '@/lib/actions/vehicles';
import {
  VEHICLE_DELETE_COUNT_CHANGED_MESSAGE,
  VEHICLE_DELETE_COUNT_FAILED_MESSAGE,
  VEHICLE_DELETE_FAILED_MESSAGE,
  VEHICLE_DELETE_NOT_FOUND_MESSAGE,
} from '@/lib/vehicle-delete';

type QueryResponse = {
  base?: { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };
  single?: { data?: unknown; error?: { message: string } | null };
};

function createQuery(response: QueryResponse = {}) {
  const base = response.base ?? { data: null, error: null, count: null };
  const single = response.single ?? { data: null, error: null };
  const query: Record<string, unknown> = {};

  query.select = vi.fn(() => query);
  query.insert = vi.fn(() => query);
  query.update = vi.fn(() => query);
  query.delete = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.range = vi.fn(() => query);
  query.single = vi.fn(async () => single);
  query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(base).then(onFulfilled, onRejected);

  return query;
}

/** A client whose `from(table)` hands out that table's queries in call order. */
function clientFor(tables: Record<string, ReturnType<typeof createQuery>[]>) {
  const from = vi.fn((table: string) => {
    const next = tables[table]?.shift();
    if (!next) throw new Error(`unexpected query on ${table}`);
    return next;
  });
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return from;
}

function baselineCount(count: number) {
  return createQuery({ base: { data: null, error: null, count } });
}

function sessionIdPage(count: number, offset = 0) {
  return createQuery({
    base: { data: Array.from({ length: count }, (_, index) => ({ id: `sess-${offset + index}` })), error: null },
  });
}

describe('vehicles actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth error when creating vehicle while logged out', async () => {
    vi.mocked(getRealUser).mockResolvedValue(null);

    const result = await createVehicle({ nickname: 'Bike', type: 'motorcycle' });

    expect(result).toEqual({ ok: false, error: 'Not authenticated.' });
  });

  it('enforces free tier vehicle limit', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

    const profileQuery = createQuery({
      single: { data: { id: 'user-1', tier: 'free' }, error: null },
    });
    const countQuery = createQuery({
      base: { count: 1, data: null, error: null },
    });

    const from = vi
      .fn()
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('profiles');
        return profileQuery;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('vehicles');
        return countQuery;
      });

    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await createVehicle({ nickname: 'Second Bike', type: 'motorcycle' });

    expect(result).toEqual({
      ok: false,
      error: 'Free plan is limited to 1 vehicle. Upgrade to Pro for unlimited vehicles.',
    });
  });

  it('creates vehicle and revalidates garage path', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

    const profileQuery = createQuery({
      single: { data: { id: 'user-1', tier: 'pro' }, error: null },
    });
    const insertQuery = createQuery({
      single: {
        data: { id: 'veh-1', nickname: 'R6', type: 'motorcycle', user_id: 'user-1' },
        error: null,
      },
    });

    const from = vi
      .fn()
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('profiles');
        return profileQuery;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('vehicles');
        return insertQuery;
      });

    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await createVehicle({
      nickname: 'R6',
      type: 'motorcycle',
      year: 2024,
      make: 'Yamaha',
    });

    expect(result.ok).toBe(true);
    expect(insertQuery.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      nickname: 'R6',
      type: 'motorcycle',
      year: 2024,
      make: 'Yamaha',
      model: null,
      photo_url: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/garage');
  });

  it('validates year on update before database call', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

    const result = await updateVehicle('veh-1', { year: 1700 });

    expect(result).toEqual({ ok: false, error: 'Please enter a valid year.' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('counts the sessions and laps a vehicle delete would take', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const sessions = sessionIdPage(2);
    const laps = createQuery({ base: { data: null, error: null, count: 7 } });
    clientFor({ sessions: [sessions], session_laps: [laps], vehicle_baselines: [baselineCount(1)] });

    const result = await getVehicleDeletionCounts('veh-1');

    expect(result).toEqual({ ok: true, data: { sessionCount: 2, lapCount: 7, hasBaseline: true } });
    expect(sessions.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(sessions.eq).toHaveBeenCalledWith('vehicle_id', 'veh-1');
    expect(laps.in).toHaveBeenCalledWith('session_id', ['sess-0', 'sess-1']);
  });

  it('pages past the row limit rather than undercounting a long history', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const lapBatches = Array.from({ length: 11 }, () => createQuery({ base: { data: null, error: null, count: 3 } }));
    clientFor({
      sessions: [sessionIdPage(1000), sessionIdPage(1, 1000)],
      session_laps: lapBatches,
      vehicle_baselines: [baselineCount(0)],
    });

    const result = await getVehicleDeletionCounts('veh-1');

    expect(result).toEqual({ ok: true, data: { sessionCount: 1001, lapCount: 33, hasBaseline: false } });
  });

  it('reports a failed count instead of claiming the bike has no sessions', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    clientFor({ sessions: [createQuery({ base: { data: null, error: { message: 'boom', code: '500' } } })] });

    const result = await getVehicleDeletionCounts('veh-1');

    expect(result).toEqual({ ok: false, error: VEHICLE_DELETE_COUNT_FAILED_MESSAGE });
    expect(reportError).toHaveBeenCalled();
  });

  it('deletes the vehicle when the session count still matches and refreshes every list', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const deleteQuery = createQuery({ base: { data: [{ id: 'veh-1' }], error: null } });
    clientFor({
      sessions: [sessionIdPage(2)],
      session_laps: [createQuery({ base: { data: null, error: null, count: 5 } })],
      vehicle_baselines: [baselineCount(0)],
      vehicles: [deleteQuery],
    });

    const result = await deleteVehicle('veh-1', 2);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(deleteQuery.delete).toHaveBeenCalled();
    expect(deleteQuery.eq).toHaveBeenCalledWith('id', 'veh-1');
    expect(deleteQuery.eq).toHaveBeenCalledWith('user_id', 'user-1');
    for (const path of ['/garage', '/dashboard', '/sessions', '/sessions/new', '/tracks']) {
      expect(revalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it('refuses when a session was logged on the bike after the rider read the count', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const from = clientFor({
      sessions: [sessionIdPage(3)],
      session_laps: [createQuery({ base: { data: null, error: null, count: 5 } })],
      vehicle_baselines: [baselineCount(0)],
    });

    const result = await deleteVehicle('veh-1', 2);

    expect(result).toEqual({ ok: false, error: VEHICLE_DELETE_COUNT_CHANGED_MESSAGE });
    expect(from).not.toHaveBeenCalledWith('vehicles');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('reports a failure when the delete matched no vehicle', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    clientFor({
      sessions: [sessionIdPage(0)],
      vehicle_baselines: [baselineCount(0)],
      vehicles: [createQuery({ base: { data: [], error: null } })],
    });

    const result = await deleteVehicle('someone-elses-vehicle', 0);

    expect(result).toEqual({ ok: false, error: VEHICLE_DELETE_NOT_FOUND_MESSAGE });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('tells the rider nothing was removed when the database refuses the delete', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    clientFor({
      sessions: [sessionIdPage(0)],
      vehicle_baselines: [baselineCount(0)],
      vehicles: [createQuery({ base: { data: null, error: { message: 'Delete failed', code: '42501' } } })],
    });

    const result = await deleteVehicle('veh-1', 0);

    expect(result).toEqual({ ok: false, error: VEHICLE_DELETE_FAILED_MESSAGE });
    expect(reportError).toHaveBeenCalledWith(
      'vehicle-delete',
      expect.any(Error),
      expect.objectContaining({ reason: '42501', table: 'vehicles' }),
    );
  });
});
