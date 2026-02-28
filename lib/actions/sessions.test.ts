import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
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
import { getAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getUserProfile } from '@/lib/actions/vehicles';
import { createSession, getPreviousSession } from '@/lib/actions/sessions';
import type { CreateSessionInput, Session } from '@/types';

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
  query.eq = vi.fn(() => query);
  query.neq = vi.fn(() => query);
  query.or = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.single = vi.fn(async () => single);
  query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(base).then(onFulfilled, onRejected);

  return query;
}

const validInput: CreateSessionInput = {
  vehicle_id: 'veh-1',
  track_id: null,
  track_name: null,
  date: '2026-02-24',
  start_time: '09:30:00',
  session_number: 2,
  conditions: 'sunny',
  tires: {
    front: { brand: 'Pirelli', compound: 'SC1', pressure: '31' },
    rear: { brand: 'Pirelli', compound: 'SC0', pressure: '24' },
    condition: 'used',
  },
  suspension: {
    front: { preload: '4', compression: '10', rebound: '8', direction: 'in' },
    rear: { preload: '6', compression: '12', rebound: '10', direction: 'in' },
  },
  alignment: null,
  enabled_modules: {
    tires: true,
    suspension: true,
    alignment: false,
    geometry: false,
    drivetrain: false,
    aero: false,
    notes: true,
  },
  notes: 'baseline',
};

describe('sessions actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth error when creating session while logged out', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    const result = await createSession(validInput);

    expect(result).toEqual({ ok: false, error: 'Not authenticated.' });
  });

  it('enforces free tier session limit', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'free' } as never);

    const countQuery = createQuery({
      base: { count: 10, data: null, error: null },
    });
    const from = vi.fn().mockImplementation((table: string) => {
      expect(table).toBe('sessions');
      return countQuery;
    });
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await createSession(validInput);

    expect(result).toEqual({
      ok: false,
      error: 'Free plan is limited to 10 sessions. Upgrade to Pro for unlimited sessions.',
    });
  });

  it('denormalizes track name when track_id is provided without track_name', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const trackLookup = createQuery({
      single: { data: { name: 'Road America' }, error: null },
    });
    const insertQuery = createQuery({
      single: { data: { id: 'sess-1' }, error: null },
    });

    const from = vi
      .fn()
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('tracks');
        return trackLookup;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return insertQuery;
      });
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await createSession({
      ...validInput,
      track_id: 'track-1',
      track_name: null,
    });

    expect(result.ok).toBe(true);
    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        track_id: 'track-1',
        track_name: 'Road America',
        session_number: 2,
        enabled_modules: validInput.enabled_modules,
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/sessions');
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
  });

  it('returns the closest previous session for same day and earlier time', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);

    const current: Session = {
      id: 'current',
      user_id: 'user-1',
      vehicle_id: 'veh-1',
      track_id: null,
      track_name: null,
      date: '2026-02-24',
      start_time: '12:00:00',
      session_number: 2,
      conditions: 'sunny',
      tires: validInput.tires,
      suspension: validInput.suspension,
      alignment: null,
      enabled_modules: validInput.enabled_modules ?? null,
      extra_modules: null,
      notes: null,
      created_at: '2026-02-24T12:00:00Z',
      updated_at: '2026-02-24T12:00:00Z',
    };

    const priorRows: Session[] = [
      { ...current, id: 'previous', date: '2026-02-24', start_time: '11:30:00' },
      { ...current, id: 'older', date: '2026-02-23', start_time: '17:00:00' },
    ];

    const previousQuery = createQuery({
      base: { data: priorRows, error: null },
    });
    const from = vi.fn().mockImplementation((table: string) => {
      expect(table).toBe('sessions');
      return previousQuery;
    });
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await getPreviousSession(current);

    expect(result?.id).toBe('previous');
  });
});
