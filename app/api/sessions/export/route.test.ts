import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getRealUser: vi.fn(),
}));

vi.mock('@/lib/actions/vehicles', () => ({
  getUserProfile: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { getRealUser } from '@/lib/auth';
import { getUserProfile } from '@/lib/actions/vehicles';
import { createClient } from '@/lib/supabase/server';
import { GET } from '@/app/api/sessions/export/route';
import type { Session, TelemetrySummary, Vehicle } from '@/types';

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

const telemetry: TelemetrySummary = {
  id: 'telemetry-1',
  user_id: 'user-1',
  session_id: 'session-1',
  vehicle_id: 'veh-1',
  source: 'manual',
  summary: 'Four laps, steady pace.',
  metrics: {
    lap_times_ms: [104620, 104110, 103980, 104250],
    lap_count: 4,
    best_lap_ms: 103980,
    average_lap_ms: 104240,
    consistency_spread_ms: 640,
  },
  created_at: '2026-05-01T09:00:00Z',
  updated_at: '2026-05-01T09:00:00Z',
};

/**
 * The four reads the export makes, in call order. `session_environment` and
 * `telemetry_summaries` are issued together, so the mock has to answer both or
 * the export sees an undefined query rather than an empty result.
 */
function mockExportQueries(overrides: {
  environments?: ReturnType<typeof createQuery>;
  telemetry?: ReturnType<typeof createQuery>;
} = {}) {
  const sessionsQuery = createQuery({ data: [session], error: null });
  const vehiclesQuery = createQuery({ data: [vehicle], error: null });
  const environmentsQuery = overrides.environments ?? createQuery({ data: [], error: null });
  const telemetryQuery = overrides.telemetry ?? createQuery({ data: [telemetry], error: null });
  const byTable: Record<string, unknown> = {
    sessions: sessionsQuery,
    vehicles: vehiclesQuery,
    session_environment: environmentsQuery,
    telemetry_summaries: telemetryQuery,
  };
  const from = vi.fn((table: string) => byTable[table]);
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return { sessionsQuery, vehiclesQuery, environmentsQuery, telemetryQuery, from };
}

describe('GET /api/sessions/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getRealUser).mockResolvedValue(null);

    const response = await GET(new Request('http://127.0.0.1:3000/api/sessions/export'));

    expect(response.status).toBe(401);
  });

  it('returns 403 for free users', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'free' } as never);

    const response = await GET(new Request('http://127.0.0.1:3000/api/sessions/export'));

    expect(response.status).toBe(403);
  });

  it('returns csv for pro users and applies filters', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const { sessionsQuery, from } = mockExportQueries();

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
    expect(from).toHaveBeenCalledWith('telemetry_summaries');
  });

  /**
   * The Pro export shipped 60 columns of setup and weather and not one lap
   * number, on the same account whose `telemetry_summaries` row holds the best
   * lap, the average and the spread. It never read the table.
   */
  it('exports the rider\'s lap times', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const { telemetryQuery } = mockExportQueries();

    const csv = await (await GET(new Request('http://127.0.0.1:3000/api/sessions/export'))).text();
    const [header, row] = csv.trim().split('\n');
    const cell = (column: string) => row.split(',')[header.split(',').indexOf(column)];

    expect(telemetryQuery.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(telemetryQuery.in).toHaveBeenCalledWith('session_id', ['session-1']);
    expect(cell('lap_count')).toBe('4');
    expect(cell('best_lap')).toBe('1:43.980');
    expect(cell('best_lap_ms')).toBe('103980');
    expect(cell('average_lap')).toBe('1:44.240');
    expect(cell('average_lap_ms')).toBe('104240');
    expect(cell('consistency_spread_ms')).toBe('640');
    expect(cell('lap_times_ms')).toBe('104620 104110 103980 104250');
  });

  /**
   * A failed lap read is not a session with no laps, and once it is a blank
   * cell in a spreadsheet nothing distinguishes them - so the export fails
   * rather than under-reporting the rider's own pace.
   */
  it('fails the export when lap data cannot be read', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    mockExportQueries({ telemetry: createQuery({ data: null, error: { message: 'boom' } }) });

    const response = await GET(new Request('http://127.0.0.1:3000/api/sessions/export'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Unable to load lap data for export.' });
  });
});
