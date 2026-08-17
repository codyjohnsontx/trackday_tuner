import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
}));

vi.mock('@/lib/auth', () => ({
  getRealUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/actions/vehicles', () => ({
  getUserProfile: vi.fn(),
}));

import { revalidatePath, revalidateTag } from 'next/cache';
import { cookies } from 'next/headers';
import { getRealUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getUserProfile } from '@/lib/actions/vehicles';
import { DEMO_COOKIE_NAME } from '@/lib/demo/mode';
import {
  createSession,
  getComparableSessions,
  getPreviousSession,
  getSessionEnvironments,
  getTelemetrySummaries,
  replaceSessionLaps,
} from '@/lib/actions/sessions';
import { MISSING_CONDITIONS_MESSAGE } from '@/lib/session-answers';
import { COMPARABLE_SESSION_FETCH_LIMIT, COMPARABLE_SESSION_LIMIT } from '@/lib/session-compare';
import type {
  CreateSessionInput,
  Session,
  SessionEnvironment,
  TelemetrySummary,
  VehicleBaseline,
} from '@/types';

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
  query.delete = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.neq = vi.fn(() => query);
  query.or = vi.fn(() => query);
  query.ilike = vi.fn(() => query);
  query.lt = vi.fn(() => query);
  query.lte = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.single = vi.fn(async () => single);
  query.maybeSingle = vi.fn(async () => single);
  query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(base).then(onFulfilled, onRejected);

  return query;
}

/**
 * A tracks query that answers `ilike` and `eq` the way the database does, so the
 * filter the action builds is what decides the match rather than the mock.
 *
 * The lookup is narrowed server-side now, which means a filter tighter than the
 * fold - matching the raw typed string, say - silently stops finding circuits the
 * rider already has. Only a query mock that applies the filter can catch that.
 */
function createTrackNameQuery(rows: { id: string; name: string }[]) {
  let matched = rows;
  const query: Record<string, unknown> = {};

  query.select = vi.fn(() => query);
  query.or = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.eq = vi.fn((column: string, value: unknown) => {
    if (column === 'name') matched = matched.filter((row) => row.name === value);
    return query;
  });
  query.ilike = vi.fn((column: string, pattern: string) => {
    if (column !== 'name') return query;
    // `%` is any run of characters, and the comparison folds case.
    const source = pattern
      .split('%')
      .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\s\\S]*');
    const expression = new RegExp(`^${source}$`, 'i');
    matched = matched.filter((row) => expression.test(row.name));
    return query;
  });
  query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: matched, error: null }).then(onFulfilled, onRejected);

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

const createdSession: Session = {
  id: 'sess-1',
  user_id: 'user-1',
  vehicle_id: 'veh-1',
  track_id: null,
  track_name: null,
  date: '2026-02-24',
  start_time: '09:30:00',
  session_number: 2,
  conditions: 'sunny',
  tires: validInput.tires,
  suspension: validInput.suspension,
  alignment: null,
  enabled_modules: validInput.enabled_modules ?? null,
  extra_modules: null,
  notes: 'baseline',
  created_at: '2026-02-24T09:30:00Z',
  updated_at: '2026-02-24T09:30:00Z',
};

const previousSession: Session = {
  ...createdSession,
  id: 'sess-0',
  date: '2026-02-23',
  start_time: '15:00:00',
  session_number: 1,
  tires: {
    ...validInput.tires,
    front: { ...validInput.tires.front, pressure: '33' },
  },
};

const changeBaseline: VehicleBaseline = {
  id: 'baseline-1',
  user_id: 'user-1',
  vehicle_id: 'veh-1',
  source_session_id: 'baseline-source',
  source_track_id: null,
  source_track_name: 'MSR Cresson',
  source_date: '2026-02-20',
  source_start_time: '10:00:00',
  source_session_number: 4,
  source_conditions: 'sunny',
  tires: previousSession.tires,
  suspension: validInput.suspension,
  alignment: null,
  enabled_modules: validInput.enabled_modules ?? {},
  extra_modules: null,
  notes: null,
  created_at: '2026-02-20T10:00:00Z',
  updated_at: '2026-02-20T10:00:00Z',
};

describe('sessions actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => undefined) } as never);
  });

  it('returns auth error when creating session while logged out', async () => {
    vi.mocked(getRealUser).mockResolvedValue(null);

    const result = await createSession(validInput);

    expect(result).toEqual({ ok: false, error: 'Not authenticated.' });
  });

  it('refuses a session whose weather the rider never answered', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn(), rpc: vi.fn() } as never);

    const result = await createSession({
      ...validInput,
      conditions: null as unknown as CreateSessionInput['conditions'],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe(MISSING_CONDITIONS_MESSAGE);
  });

  it('enforces free tier session limit', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'free' } as never);

    const countQuery = createQuery({
      base: { count: 10, data: null, error: null },
    });
    const from = vi.fn().mockImplementation((table: string) => {
      expect(table).toBe('sessions');
      return countQuery;
    });
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession(validInput);

    expect(result).toEqual({
      ok: false,
      error: 'Free plan is limited to 10 sessions. Upgrade to Pro for unlimited sessions.',
    });
  });

  it('denormalizes track name when track_id is provided without track_name', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
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
      })
      // Change-tracking follow-up queries: resolvable vehicle type, no previous session or baseline.
      .mockImplementation(() =>
        createQuery({ base: { data: [], error: null }, single: { data: { type: 'motorcycle' }, error: null } }),
      );
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

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

  it('links a typed track name to the saved track it names', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const visibleTracks = createQuery({
      base: { data: [{ id: 'track-9', name: 'Eagles Canyon Raceway' }], error: null },
    });
    const insertQuery = createQuery({ single: { data: { id: 'sess-1' }, error: null } });

    const from = vi
      .fn()
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('tracks');
        return visibleTracks;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return insertQuery;
      })
      .mockImplementation(() =>
        createQuery({ base: { data: [], error: null }, single: { data: { type: 'motorcycle' }, error: null } }),
      );
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    // Typed with different case and doubled spacing, as a rider does.
    const result = await createSession({
      ...validInput,
      track_id: null,
      track_name: 'eagles  canyon raceway',
    });

    expect(result.ok).toBe(true);
    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ track_id: 'track-9', track_name: 'Eagles Canyon Raceway' }),
    );
  });

  it('finds a doubled-space spelling through the narrowed track query', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const visibleTracks = createTrackNameQuery([
      { id: 'track-9', name: 'Eagles Canyon Raceway' },
      { id: 'track-8', name: 'Harris Hill Raceway' },
    ]);
    const insertQuery = createQuery({ single: { data: { id: 'sess-1' }, error: null } });

    const from = vi
      .fn()
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('tracks');
        return visibleTracks;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return insertQuery;
      })
      .mockImplementation(() =>
        createQuery({ base: { data: [], error: null }, single: { data: { type: 'motorcycle' }, error: null } }),
      );
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession({
      ...validInput,
      track_id: null,
      track_name: 'eagles  canyon raceway',
    });

    expect(result.ok).toBe(true);
    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ track_id: 'track-9', track_name: 'Eagles Canyon Raceway' }),
    );
    // Narrowed and bounded in the database rather than read whole and folded here.
    expect(visibleTracks.ilike).toHaveBeenCalled();
    expect(visibleTracks.limit).toHaveBeenCalled();
  });

  it('finds a decomposed accent on its precomposed row through the narrowed track query', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const precomposedName = 'Aut\u00f3dromo Hermanos Rodr\u00edguez';
    const visibleTracks = createTrackNameQuery([{ id: 'track-7', name: precomposedName }]);
    const insertQuery = createQuery({ single: { data: { id: 'sess-1' }, error: null } });

    const from = vi
      .fn()
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('tracks');
        return visibleTracks;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return insertQuery;
      })
      .mockImplementation(() =>
        createQuery({ base: { data: [], error: null }, single: { data: { type: 'motorcycle' }, error: null } }),
      );
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    // Typed with combining acutes against a row stored precomposed: one circuit,
    // and a filter that compared the raw string would create a second row for it.
    const result = await createSession({
      ...validInput,
      track_id: null,
      track_name: 'Auto\u0301dromo Hermanos Rodri\u0301guez',
    });

    expect(result.ok).toBe(true);
    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ track_id: 'track-7', track_name: precomposedName }),
    );
  });

  it('saves a typed track the rider has never logged as a track of their own', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const visibleTracks = createQuery({ base: { data: [], error: null } });
    const trackInsert = createQuery({
      single: { data: { id: 'track-new', name: 'Harris Hill Raceway' }, error: null },
    });
    const insertQuery = createQuery({ single: { data: { id: 'sess-1' }, error: null } });

    const from = vi
      .fn()
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('tracks');
        return visibleTracks;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('tracks');
        return trackInsert;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return insertQuery;
      })
      .mockImplementation(() =>
        createQuery({ base: { data: [], error: null }, single: { data: { type: 'motorcycle' }, error: null } }),
      );
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession({
      ...validInput,
      track_id: null,
      track_name: 'Harris Hill Raceway',
    });

    expect(result.ok).toBe(true);
    // The row is the rider's own, which is what the tracks RLS insert policy admits.
    expect(trackInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Harris Hill Raceway', is_seeded: false, created_by: 'user-1' }),
    );
    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ track_id: 'track-new', track_name: 'Harris Hill Raceway' }),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/tracks');
    expect(revalidateTag).toHaveBeenCalledWith('tracks');
  });

  it('still saves the session when the track row cannot be created', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const visibleTracks = createQuery({ base: { data: [], error: null } });
    const trackInsert = createQuery({ single: { data: null, error: { message: 'insert refused' } } });
    const insertQuery = createQuery({ single: { data: { id: 'sess-1' }, error: null } });

    const from = vi
      .fn()
      .mockImplementationOnce(() => visibleTracks)
      .mockImplementationOnce(() => trackInsert)
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return insertQuery;
      })
      .mockImplementation(() =>
        createQuery({ base: { data: [], error: null }, single: { data: { type: 'motorcycle' }, error: null } }),
      );
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession({
      ...validInput,
      track_id: null,
      track_name: 'Harris Hill Raceway',
    });

    expect(result.ok).toBe(true);
    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ track_id: null, track_name: 'Harris Hill Raceway' }),
    );
    errorSpy.mockRestore();
  });

  it('does not create a track for a free rider already at the plan limit', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'free' } as never);

    const sessionCount = createQuery({ base: { count: 0, data: null, error: null } });
    const visibleTracks = createQuery({ base: { data: [], error: null } });
    const trackCount = createQuery({ base: { count: 3, data: null, error: null } });
    const insertQuery = createQuery({ single: { data: { id: 'sess-1' }, error: null } });

    const from = vi
      .fn()
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return sessionCount;
      })
      .mockImplementationOnce(() => visibleTracks)
      .mockImplementationOnce(() => trackCount)
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return insertQuery;
      })
      .mockImplementation(() =>
        createQuery({ base: { data: [], error: null }, single: { data: { type: 'motorcycle' }, error: null } }),
      );
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession({
      ...validInput,
      track_id: null,
      track_name: 'Harris Hill Raceway',
    });

    // The session is still logged - hitting the track cap must not cost the rider
    // the session they just rode.
    expect(result.ok).toBe(true);
    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ track_id: null, track_name: 'Harris Hill Raceway' }),
    );
  });

  it('removes the track it just created when the session insert fails', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const visibleTracks = createQuery({ base: { data: [], error: null } });
    const trackInsert = createQuery({
      single: { data: { id: 'track-new', name: 'Harris Hill Raceway' }, error: null },
    });
    const sessionInsert = createQuery({ single: { data: null, error: { message: 'session refused' } } });
    const trackRollback = createQuery({ base: { data: null, error: null } });

    const from = vi
      .fn()
      .mockImplementationOnce(() => visibleTracks)
      .mockImplementationOnce(() => trackInsert)
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return sessionInsert;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('tracks');
        return trackRollback;
      })
      .mockImplementation(() => createQuery({ base: { data: [], error: null } }));
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession({
      ...validInput,
      track_id: null,
      track_name: 'Harris Hill Raceway',
    });

    expect(result.ok).toBe(false);
    // The rider did not save a session, so they must not be left holding a track
    // for it - on the free plan that would consume one of only three slots.
    expect(trackRollback.delete).toHaveBeenCalled();
    expect(trackRollback.eq).toHaveBeenCalledWith('id', 'track-new');
    expect(trackRollback.eq).toHaveBeenCalledWith('created_by', 'user-1');
  });

  it('leaves a track it did not create alone when the session insert fails', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const visibleTracks = createQuery({
      base: { data: [{ id: 'track-9', name: 'Eagles Canyon Raceway' }], error: null },
    });
    const sessionInsert = createQuery({ single: { data: null, error: { message: 'session refused' } } });

    const from = vi
      .fn()
      .mockImplementationOnce(() => visibleTracks)
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return sessionInsert;
      })
      .mockImplementation(() => {
        throw new Error('nothing else should be queried');
      });
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession({
      ...validInput,
      track_id: null,
      track_name: 'Eagles Canyon Raceway',
    });

    expect(result.ok).toBe(false);
    // Matched, not created: it was already the rider's own track.
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('stores the track row\'s own name rather than a name typed beside its id', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const trackLookup = createQuery({
      single: { data: { id: 'track-1', name: 'Road America' }, error: null },
    });
    const insertQuery = createQuery({ single: { data: { id: 'sess-1' }, error: null } });

    const from = vi
      .fn()
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('tracks');
        return trackLookup;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return insertQuery;
      })
      .mockImplementation(() =>
        createQuery({ base: { data: [], error: null }, single: { data: { type: 'motorcycle' }, error: null } }),
      );
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession({
      ...validInput,
      track_id: 'track-1',
      track_name: 'Somewhere Else Entirely',
    });

    expect(result.ok).toBe(true);
    // The id and the name must name the same circuit.
    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ track_id: 'track-1', track_name: 'Road America' }),
    );
  });

  it('falls back to the typed name when the track id is not one the rider can see', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    // Someone else's track: RLS hides the row, so the lookup returns nothing.
    const trackLookup = createQuery({ single: { data: null, error: null } });
    const visibleTracks = createQuery({ base: { data: [], error: null } });
    const trackInsert = createQuery({
      single: { data: { id: 'track-mine', name: 'Harris Hill Raceway' }, error: null },
    });
    const insertQuery = createQuery({ single: { data: { id: 'sess-1' }, error: null } });

    const from = vi
      .fn()
      .mockImplementationOnce(() => trackLookup)
      .mockImplementationOnce(() => visibleTracks)
      .mockImplementationOnce(() => trackInsert)
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return insertQuery;
      })
      .mockImplementation(() =>
        createQuery({ base: { data: [], error: null }, single: { data: { type: 'motorcycle' }, error: null } }),
      );
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession({
      ...validInput,
      track_id: 'someone-elses-track',
      track_name: 'Harris Hill Raceway',
    });

    expect(result.ok).toBe(true);
    // Never stores a link the rider cannot follow.
    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ track_id: 'track-mine', track_name: 'Harris Hill Raceway' }),
    );
  });

  it('rolls back the session when environment insert fails', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const insertQuery = createQuery({
      single: { data: { id: 'sess-1', ...validInput }, error: null },
    });
    const environmentInsertQuery = createQuery({
      base: { data: null, error: { message: 'env failed' } },
    });
    const rollbackQuery = createQuery({
      base: { data: [{ id: 'sess-1' }], error: null },
    });

    const from = vi
      .fn()
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return insertQuery;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('session_environment');
        return environmentInsertQuery;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return rollbackQuery;
      });
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession({
      ...validInput,
      environment: {
        ambient_temperature_c: 24,
        source: 'manual',
      },
    });

    expect(result).toEqual({ ok: false, error: 'env failed' });
    expect(rollbackQuery.delete).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      '[sessions] session_environment insert failed',
      expect.objectContaining({
        userId: 'user-1',
        sessionId: 'sess-1',
        error: 'env failed',
      }),
    );
    errorSpy.mockRestore();
  });

  it('keeps the auto-created track when the session delete removed no row', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const visibleTracks = createQuery({ base: { data: [], error: null } });
    const trackInsert = createQuery({
      single: { data: { id: 'track-new', name: 'Harris Hill Raceway' }, error: null },
    });
    const sessionInsert = createQuery({
      single: { data: { id: 'sess-1', ...validInput }, error: null },
    });
    const environmentInsert = createQuery({ base: { data: null, error: { message: 'env failed' } } });
    // No error, and no row either: RLS refusing a delete looks exactly like this.
    const sessionRollback = createQuery({ base: { data: [], error: null } });
    const trackRollback = createQuery({ base: { data: null, error: null } });

    const from = vi
      .fn()
      .mockImplementationOnce(() => visibleTracks)
      .mockImplementationOnce(() => trackInsert)
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return sessionInsert;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('session_environment');
        return environmentInsert;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return sessionRollback;
      })
      .mockImplementation(() => trackRollback);
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession({
      ...validInput,
      track_id: null,
      track_name: 'Harris Hill Raceway',
      environment: { ambient_temperature_c: 24, source: 'manual' },
    });

    expect(result).toEqual({ ok: false, error: 'env failed' });
    // Silence is not proof the session went, and `sessions.track_id` is
    // ON DELETE SET NULL, so deleting the track now would strip the circuit off a
    // session the rider still has.
    expect(trackRollback.delete).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(5);
    expect(errorSpy).toHaveBeenCalledWith(
      '[sessions] session rollback failed',
      expect.objectContaining({ userId: 'user-1', sessionId: 'sess-1', error: 'no rows deleted' }),
    );
    errorSpy.mockRestore();
  });

  it('keeps the auto-created track when the session it belongs to could not be deleted', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const visibleTracks = createQuery({ base: { data: [], error: null } });
    const trackInsert = createQuery({
      single: { data: { id: 'track-new', name: 'Harris Hill Raceway' }, error: null },
    });
    const sessionInsert = createQuery({
      single: { data: { id: 'sess-1', ...validInput }, error: null },
    });
    const environmentInsert = createQuery({ base: { data: null, error: { message: 'env failed' } } });
    const sessionRollback = createQuery({ base: { data: null, error: { message: 'delete refused' } } });
    const trackRollback = createQuery({ base: { data: null, error: null } });

    const from = vi
      .fn()
      .mockImplementationOnce(() => visibleTracks)
      .mockImplementationOnce(() => trackInsert)
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return sessionInsert;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('session_environment');
        return environmentInsert;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return sessionRollback;
      })
      .mockImplementation(() => trackRollback);
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession({
      ...validInput,
      track_id: null,
      track_name: 'Harris Hill Raceway',
      environment: { ambient_temperature_c: 24, source: 'manual' },
    });

    expect(result).toEqual({ ok: false, error: 'env failed' });
    // The session row survived its own delete, and `sessions.track_id` is
    // ON DELETE SET NULL, so removing the track now would strip the circuit off a
    // session the rider still has. A stray track is the lesser failure.
    expect(trackRollback.delete).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(5);
    expect(errorSpy).toHaveBeenCalledWith(
      '[sessions] session rollback failed',
      expect.objectContaining({ userId: 'user-1', sessionId: 'sess-1', error: 'delete refused' }),
    );
    errorSpy.mockRestore();
  });

  it('persists change records against the previous session and the active baseline', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const insertQuery = createQuery({ single: { data: createdSession, error: null } });
    const vehicleQuery = createQuery({ single: { data: { type: 'motorcycle' }, error: null } });
    const previousQuery = createQuery({ base: { data: [previousSession], error: null } });
    const baselineQuery = createQuery({ base: { data: [changeBaseline], error: null } });
    const changesInsertQuery = createQuery({ base: { data: null, error: null } });

    const from = vi
      .fn()
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return insertQuery;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('vehicles');
        return vehicleQuery;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('sessions');
        return previousQuery;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('vehicle_baselines');
        return baselineQuery;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('session_changes');
        return changesInsertQuery;
      });
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession(validInput);

    expect(result.ok).toBe(true);
    expect(changesInsertQuery.insert).toHaveBeenCalledTimes(1);
    const insertedRows = vi.mocked(changesInsertQuery.insert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<Record<string, unknown>>;
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows.map((row) => row.reference_kind)).toEqual(['previous', 'baseline']);
    expect(insertedRows[0]).toMatchObject({ session_id: 'sess-1', reference_session_id: 'sess-0' });
    expect(insertedRows[1]).toMatchObject({ session_id: 'sess-1', reference_session_id: 'baseline-source' });
  });

  it('persists a single change record when only a previous session exists', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const insertQuery = createQuery({ single: { data: createdSession, error: null } });
    const vehicleQuery = createQuery({ single: { data: { type: 'motorcycle' }, error: null } });
    const previousQuery = createQuery({ base: { data: [previousSession], error: null } });
    const baselineQuery = createQuery({ base: { data: [], error: null } });
    const changesInsertQuery = createQuery({ base: { data: null, error: null } });

    const from = vi
      .fn()
      .mockImplementationOnce(() => insertQuery)
      .mockImplementationOnce(() => vehicleQuery)
      .mockImplementationOnce(() => previousQuery)
      .mockImplementationOnce(() => baselineQuery)
      .mockImplementationOnce(() => changesInsertQuery);
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession(validInput);

    expect(result.ok).toBe(true);
    const insertedRows = vi.mocked(changesInsertQuery.insert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<Record<string, unknown>>;
    expect(insertedRows.map((row) => row.reference_kind)).toEqual(['previous']);
  });

  it('writes no change records when there is no reference to compare against', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const insertQuery = createQuery({ single: { data: createdSession, error: null } });
    const vehicleQuery = createQuery({ single: { data: { type: 'motorcycle' }, error: null } });
    const previousQuery = createQuery({ base: { data: [], error: null } });
    const baselineQuery = createQuery({ base: { data: [], error: null } });

    const from = vi
      .fn()
      .mockImplementationOnce(() => insertQuery)
      .mockImplementationOnce(() => vehicleQuery)
      .mockImplementationOnce(() => previousQuery)
      .mockImplementationOnce(() => baselineQuery);
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession(validInput);

    expect(result.ok).toBe(true);
    expect(from).toHaveBeenCalledTimes(4);
    expect(from).not.toHaveBeenCalledWith('session_changes');
  });

  it('still succeeds without rollback when the change-record insert fails', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const insertQuery = createQuery({ single: { data: createdSession, error: null } });
    const vehicleQuery = createQuery({ single: { data: { type: 'motorcycle' }, error: null } });
    const previousQuery = createQuery({ base: { data: [previousSession], error: null } });
    const baselineQuery = createQuery({ base: { data: [changeBaseline], error: null } });
    const changesInsertQuery = createQuery({ base: { data: null, error: { message: 'changes failed' } } });

    const from = vi
      .fn()
      .mockImplementationOnce(() => insertQuery)
      .mockImplementationOnce(() => vehicleQuery)
      .mockImplementationOnce(() => previousQuery)
      .mockImplementationOnce(() => baselineQuery)
      .mockImplementationOnce(() => changesInsertQuery);
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession(validInput);

    expect(result).toEqual({ ok: true, data: createdSession });
    expect(from).toHaveBeenCalledTimes(5);
    expect(insertQuery.delete).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      '[sessions] session_changes insert failed',
      expect.objectContaining({
        userId: 'user-1',
        sessionId: 'sess-1',
        error: 'changes failed',
      }),
    );
    errorSpy.mockRestore();
  });

  it('skips persisting change records when the vehicle type cannot be resolved', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const insertQuery = createQuery({ single: { data: createdSession, error: null } });
    const vehicleQuery = createQuery({ single: { data: null, error: { message: 'not found' } } });
    const previousQuery = createQuery({ base: { data: [previousSession], error: null } });
    const baselineQuery = createQuery({ base: { data: [changeBaseline], error: null } });

    const from = vi
      .fn()
      .mockImplementationOnce(() => insertQuery)
      .mockImplementationOnce(() => vehicleQuery)
      .mockImplementationOnce(() => previousQuery)
      .mockImplementationOnce(() => baselineQuery);
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await createSession(validInput);

    expect(result).toEqual({ ok: true, data: createdSession });
    expect(from).toHaveBeenCalledTimes(4);
    expect(from).not.toHaveBeenCalledWith('session_changes');
    expect(errorSpy).toHaveBeenCalledWith(
      '[sessions] session_changes skipped: unresolved vehicle type',
      expect.objectContaining({ userId: 'user-1', sessionId: 'sess-1', vehicleId: 'veh-1' }),
    );
    errorSpy.mockRestore();
  });

  it('returns the closest previous session for same day and earlier time', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

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
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await getPreviousSession(current);

    expect(result?.id).toBe('previous');
  });

  it('prioritizes same-track comparable sessions before applying the final cap', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

    const current: Session = {
      id: 'current',
      user_id: 'user-1',
      vehicle_id: 'veh-1',
      track_id: 'track-1',
      track_name: 'MSR Cresson',
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
    const offTrackRows: Session[] = Array.from({ length: COMPARABLE_SESSION_LIMIT + 1 }, (_, index) => ({
      ...current,
      id: `other-track-${index}`,
      track_id: `track-${index + 2}`,
      track_name: `Other Track ${index}`,
      created_at: `2026-02-24T11:${String(59 - index).padStart(2, '0')}:00Z`,
    }));
    const sameTrackBeyondFinalCap: Session = {
      ...current,
      id: 'same-track-beyond-final-cap',
      created_at: '2026-02-24T10:30:00Z',
    };
    const comparableRows: Session[] = [...offTrackRows, sameTrackBeyondFinalCap];

    const comparableQuery = createQuery({
      base: { data: comparableRows, error: null },
    });
    const from = vi.fn().mockImplementation((table: string) => {
      expect(table).toBe('sessions');
      return comparableQuery;
    });
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await getComparableSessions(current);

    expect(comparableQuery.limit).toHaveBeenCalledWith(COMPARABLE_SESSION_FETCH_LIMIT);
    expect(result).toHaveLength(COMPARABLE_SESSION_LIMIT);
    expect(result.map((session) => session.id)).toContain('same-track-beyond-final-cap');
    expect(result[0]?.id).toBe('same-track-beyond-final-cap');
  });

  it('returns environment rows for the requested sessions', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

    const environments: SessionEnvironment[] = [
      {
        id: 'env-1',
        user_id: 'user-1',
        session_id: 'session-1',
        ambient_temperature_c: 24,
        track_temperature_c: 36,
        humidity_percent: 50,
        weather_condition: 'Warming',
        surface_condition: 'Rubbered in',
        source: 'manual',
        created_at: '2026-02-24T09:30:00Z',
        updated_at: '2026-02-24T09:30:00Z',
      },
    ];

    const environmentQuery = createQuery({
      base: { data: environments, error: null },
    });
    const from = vi.fn().mockImplementation((table: string) => {
      expect(table).toBe('session_environment');
      return environmentQuery;
    });
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await getSessionEnvironments(['session-1']);

    expect(environmentQuery.in).toHaveBeenCalledWith('session_id', ['session-1']);
    expect(result).toEqual(environments);
  });

  it('returns telemetry summaries for requested session ids', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

    const summaries: TelemetrySummary[] = [
      {
        id: 'telemetry-1',
        user_id: 'user-1',
        session_id: 'session-1',
        vehicle_id: 'veh-1',
        source: 'test',
        summary: null,
        metrics: { best_lap_ms: 95000 },
        created_at: '2026-02-24T09:30:00Z',
        updated_at: '2026-02-24T09:30:00Z',
      },
    ];

    const telemetryQuery = createQuery({
      base: { data: summaries, error: null },
    });
    const from = vi.fn().mockImplementation((table: string) => {
      expect(table).toBe('telemetry_summaries');
      return telemetryQuery;
    });
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);

    const result = await getTelemetrySummaries(['session-1']);

    expect(telemetryQuery.in).toHaveBeenCalledWith('session_id', ['session-1']);
    expect(result).toEqual(summaries);
  });

  it('returns no telemetry summaries for empty input', async () => {
    const result = await getTelemetrySummaries([]);

    expect(result).toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('aborts lap replacement when the session lookup fails', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const sessionQuery = createQuery({
      single: { data: null, error: { message: 'snapshot failed' } },
    });
    const from = vi.fn(() => sessionQuery);
    const rpc = vi.fn();
    vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);

    const result = await replaceSessionLaps('session-1', []);

    expect(result).toEqual({ ok: false, error: 'snapshot failed' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the transactional RPC error when lap replacement fails', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const sessionQuery = createQuery({
      single: { data: createdSession, error: null },
    });
    const from = vi.fn(() => sessionQuery);
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'lap transaction failed' } }));
    vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);

    const result = await replaceSessionLaps('sess-1', []);

    expect(result).toEqual({ ok: false, error: 'lap transaction failed' });
    expect(rpc).toHaveBeenCalledWith('replace_session_laps', {
      p_user_id: 'user-1',
      p_session_id: 'sess-1',
      p_laps: [],
    });
  });

  it('returns demo telemetry summaries without calling Supabase', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => ({ value: '1', name: DEMO_COOKIE_NAME })) } as never);

    const result = await getTelemetrySummaries(['demo-session-4']);

    expect(result).toHaveLength(1);
    expect(result[0]?.session_id).toBe('demo-session-4');
    expect(createClient).not.toHaveBeenCalled();
  });
});
