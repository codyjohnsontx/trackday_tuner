import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock('@/lib/actions/vehicles', () => ({
  getUserProfile: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { getAuthenticatedUser } from '@/lib/auth';
import { getUserProfile } from '@/lib/actions/vehicles';
import { createClient } from '@/lib/supabase/server';
import { GET } from '@/app/api/sessions/export/route';
import type { Session, Vehicle } from '@/types';

type QueryResponse = {
  data?: unknown;
  error?: { message: string } | null;
};

function createQuery(response: QueryResponse) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.gte = vi.fn(() => query);
  query.lte = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(response).then(onFulfilled, onRejected);
  return query;
}

const vehicle: Vehicle = {
  id: 'veh-1',
  user_id: 'user-1',
  nickname: 'R6',
  type: 'motorcycle',
  year: 2020,
  make: 'Yamaha',
  model: 'YZF-R6',
  photo_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const session: Session = {
  id: 'session-1',
  user_id: 'user-1',
  vehicle_id: 'veh-1',
  track_id: null,
  track_name: 'Road America',
  date: '2026-05-01',
  start_time: '09:30:00',
  session_number: 1,
  conditions: 'sunny',
  tires: {
    front: { brand: 'Pirelli', compound: 'SC1', pressure: '31' },
    rear: { brand: 'Pirelli', compound: 'SC0', pressure: '24' },
    condition: 'used',
  },
  suspension: {
    front: { preload: '4', compression: '10', rebound: '8', direction: 'out' },
    rear: { preload: '6', compression: '12', rebound: '10', direction: 'out' },
  },
  alignment: null,
  enabled_modules: null,
  extra_modules: null,
  notes: 'baseline',
  created_at: '2026-05-01T09:00:00Z',
  updated_at: '2026-05-01T09:00:00Z',
};

describe('GET /api/sessions/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    const response = await GET(new Request('http://127.0.0.1:3000/api/sessions/export'));

    expect(response.status).toBe(401);
  });

  it('returns 403 for free users', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'free' } as never);

    const response = await GET(new Request('http://127.0.0.1:3000/api/sessions/export'));

    expect(response.status).toBe(403);
  });

  it('returns csv for pro users and applies filters', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const sessionsQuery = createQuery({ data: [session], error: null });
    const vehiclesQuery = createQuery({ data: [vehicle], error: null });
    const environmentsQuery = createQuery({ data: [], error: null });
    const from = vi
      .fn()
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return sessionsQuery;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('vehicles');
        return vehiclesQuery;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('session_environment');
        return environmentsQuery;
      });
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const response = await GET(
      new Request('http://127.0.0.1:3000/api/sessions/export?vehicleId=veh-1&from=2026-05-01&to=2026-05-31'),
    );
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('trackday-tuner-sessions-');
    expect(sessionsQuery.eq).toHaveBeenCalledWith('vehicle_id', 'veh-1');
    expect(sessionsQuery.gte).toHaveBeenCalledWith('date', '2026-05-01');
    expect(sessionsQuery.lte).toHaveBeenCalledWith('date', '2026-05-31');
    expect(csv).toContain('session_id,vehicle_id,vehicle_nickname');
    expect(csv).toContain('session-1,veh-1,R6');
  });
});
