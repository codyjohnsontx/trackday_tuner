import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
}));

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/actions/vehicles', () => ({
  getUserProfile: vi.fn(),
}));

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { getAuthenticatedUser } from '@/lib/auth';
import { getUserProfile } from '@/lib/actions/vehicles';
import {
  clearVehicleBaseline,
  getVehicleBaseline,
  getVehicleBaselines,
  setVehicleBaselineFromSession,
} from '@/lib/actions/baselines';
import { createClient } from '@/lib/supabase/server';
import { DEMO_COOKIE_NAME, DEMO_READ_ONLY_ERROR } from '@/lib/demo/mode';
import type { Session, VehicleBaseline } from '@/types';

type QueryResponse = {
  base?: { data?: unknown; error?: { message: string } | null; count?: number | null };
  single?: { data?: unknown; error?: { message: string } | null };
};

function createQuery(response: QueryResponse = {}) {
  const base = response.base ?? { data: null, error: null, count: null };
  const single = response.single ?? { data: null, error: null };
  const query: Record<string, unknown> = {};

  query.select = vi.fn(() => query);
  query.insert = vi.fn(() => query);
  query.upsert = vi.fn(() => query);
  query.update = vi.fn(() => query);
  query.delete = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.single = vi.fn(async () => single);
  query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(base).then(onFulfilled, onRejected);

  return query;
}

const session: Session = {
  id: 'session-1',
  user_id: 'user-1',
  vehicle_id: 'vehicle-1',
  track_id: 'track-1',
  track_name: 'Road America',
  date: '2026-06-24',
  start_time: '10:30:00',
  session_number: 2,
  conditions: 'sunny',
  tires: {
    condition: 'scrubbed',
    front: { brand: 'Pirelli', compound: 'SC1', pressure: '33 psi hot' },
    rear: { brand: 'Pirelli', compound: 'SC2', pressure: '26 psi hot' },
  },
  suspension: {
    front: { preload: '5 turns', compression: '12 clicks', rebound: '10 clicks', direction: 'out' },
    rear: { preload: '8 mm', compression: '11 clicks', rebound: '12 clicks', direction: 'out' },
  },
  alignment: null,
  enabled_modules: {
    tires: true,
    suspension: true,
    alignment: false,
    geometry: true,
    drivetrain: false,
    aero: false,
    notes: true,
  },
  extra_modules: {
    geometry: {
      sag_front: '35 mm',
      sag_rear: '29 mm',
      notes: 'Stable baseline',
    },
  },
  notes: 'Known-good setup',
  created_at: '2026-06-24T10:30:00.000Z',
  updated_at: '2026-06-24T10:30:00.000Z',
};

const baseline: VehicleBaseline = {
  id: 'baseline-1',
  user_id: 'user-1',
  vehicle_id: 'vehicle-1',
  source_session_id: session.id,
  source_track_id: session.track_id,
  source_track_name: session.track_name,
  source_date: session.date,
  source_start_time: session.start_time,
  source_session_number: session.session_number,
  source_conditions: session.conditions,
  tires: session.tires,
  suspension: session.suspension,
  alignment: session.alignment,
  enabled_modules: session.enabled_modules ?? {},
  extra_modules: session.extra_modules,
  notes: session.notes,
  created_at: session.created_at,
  updated_at: session.updated_at,
};

describe('baseline actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => undefined) } as never);
  });

  it('returns a baseline for the authenticated user', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    const baselineQuery = createQuery({ base: { data: [baseline], error: null } });
    const from = vi.fn().mockReturnValue(baselineQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await getVehicleBaseline('vehicle-1');

    expect(from).toHaveBeenCalledWith('vehicle_baselines');
    expect(baselineQuery.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(baselineQuery.eq).toHaveBeenCalledWith('vehicle_id', 'vehicle-1');
    expect(result).toEqual(baseline);
  });

  it('returns null when getting a baseline while logged out', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    await expect(getVehicleBaseline('vehicle-1')).resolves.toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns no baselines for empty input without calling Supabase', async () => {
    await expect(getVehicleBaselines([])).resolves.toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('filters baseline lookup by requested vehicle ids', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    const baselinesQuery = createQuery({ base: { data: [baseline], error: null } });
    const from = vi.fn().mockReturnValue(baselinesQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await getVehicleBaselines(['vehicle-1', 'vehicle-2']);

    expect(baselinesQuery.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(baselinesQuery.in).toHaveBeenCalledWith('vehicle_id', ['vehicle-1', 'vehicle-2']);
    expect(result).toEqual([baseline]);
  });

  it('rejects setting a baseline while logged out', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    const result = await setVehicleBaselineFromSession('session-1');

    expect(result).toEqual({ ok: false, error: 'Not authenticated.' });
  });

  it('rejects setting a baseline for free users', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'free' } as never);

    const result = await setVehicleBaselineFromSession('session-1');

    expect(result).toEqual({ ok: false, error: 'Vehicle baselines are a Pro feature.' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects missing sessions', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const sessionQuery = createQuery({ single: { data: null, error: { message: 'not found' } } });
    const from = vi.fn().mockReturnValue(sessionQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await setVehicleBaselineFromSession('missing-session');

    expect(result).toEqual({ ok: false, error: 'Session not found.' });
  });

  it('upserts a snapshot from an owned session', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const sessionQuery = createQuery({ single: { data: session, error: null } });
    const vehicleQuery = createQuery({ single: { data: { id: 'vehicle-1' }, error: null } });
    const upsertQuery = createQuery({ single: { data: baseline, error: null } });
    const from = vi
      .fn()
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return sessionQuery;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('vehicles');
        return vehicleQuery;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('vehicle_baselines');
        return upsertQuery;
      });
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await setVehicleBaselineFromSession('session-1');

    expect(result).toEqual({ ok: true, data: baseline });
    expect(upsertQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        vehicle_id: 'vehicle-1',
        source_session_id: 'session-1',
        source_track_id: 'track-1',
        source_track_name: 'Road America',
        source_date: '2026-06-24',
        source_start_time: '10:30:00',
        source_session_number: 2,
        source_conditions: 'sunny',
        tires: session.tires,
        suspension: session.suspension,
        alignment: null,
        enabled_modules: session.enabled_modules,
        extra_modules: session.extra_modules,
        notes: 'Known-good setup',
      }),
      { onConflict: 'user_id,vehicle_id' },
    );
  });

  it('revalidates garage, session detail, and compare paths after setting a baseline', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const from = vi
      .fn()
      .mockReturnValueOnce(createQuery({ single: { data: session, error: null } }))
      .mockReturnValueOnce(createQuery({ single: { data: { id: 'vehicle-1' }, error: null } }))
      .mockReturnValueOnce(createQuery({ single: { data: baseline, error: null } }));
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    await setVehicleBaselineFromSession('session-1');

    expect(revalidatePath).toHaveBeenCalledWith('/garage');
    expect(revalidatePath).toHaveBeenCalledWith('/sessions/session-1');
    expect(revalidatePath).toHaveBeenCalledWith('/sessions/session-1/compare');
  });

  it('deletes a baseline only by user and vehicle id', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const deleteQuery = createQuery({ base: { data: [{ source_session_id: 'session-1' }], error: null } });
    const from = vi.fn().mockReturnValue(deleteQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await clearVehicleBaseline('vehicle-1');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(deleteQuery.delete).toHaveBeenCalled();
    expect(deleteQuery.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(deleteQuery.eq).toHaveBeenCalledWith('vehicle_id', 'vehicle-1');
  });

  it('revalidates garage and source session paths after clearing a baseline', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const deleteQuery = createQuery({ base: { data: [{ source_session_id: 'session-1' }], error: null } });
    const from = vi.fn().mockReturnValue(deleteQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    await clearVehicleBaseline('vehicle-1');

    expect(revalidatePath).toHaveBeenCalledWith('/garage');
    expect(revalidatePath).toHaveBeenCalledWith('/sessions/session-1');
    expect(revalidatePath).toHaveBeenCalledWith('/sessions/session-1/compare');
  });

  it('does not call Supabase on demo write paths', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => ({ value: '1', name: DEMO_COOKIE_NAME })) } as never);

    await expect(setVehicleBaselineFromSession('demo-session-3')).resolves.toEqual({
      ok: false,
      error: DEMO_READ_ONLY_ERROR,
    });
    await expect(clearVehicleBaseline('demo-r6')).resolves.toEqual({
      ok: false,
      error: DEMO_READ_ONLY_ERROR,
    });
    expect(createClient).not.toHaveBeenCalled();
  });
});
