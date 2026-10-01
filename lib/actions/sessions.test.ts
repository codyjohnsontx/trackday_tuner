import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/lib/monitoring/report-error', () => ({
  reportError: vi.fn(),
}));

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { getRealUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getUserProfile } from '@/lib/actions/vehicles';
import { reportError } from '@/lib/monitoring/report-error';
import { DEMO_COOKIE_NAME } from '@/lib/demo/mode';
import {
  createSession,
  deleteSession,
  getComparableSessions,
  getPreviousSession,
  getSessionEnvironments,
  getSessionEnvironment,
  getSessionLaps,
  getSessionsAtTrack,
  getTelemetrySummaries,
  replaceSessionLaps,
} from '@/lib/actions/sessions';
import { MISSING_CONDITIONS_MESSAGE } from '@/lib/session-answers';
import { getFreePlanLimitMessage } from '@/lib/plans';
import { getSessionOutcome } from '@/lib/actions/outcomes';
import {
  SESSION_DELETE_CHANGED_AFTER_PHOTO_MESSAGE,
  SESSION_DELETE_CHANGED_MESSAGE,
  SESSION_DELETE_FAILED_AFTER_PHOTO_MESSAGE,
  SESSION_DELETE_FAILED_MESSAGE,
  SESSION_DELETE_NOT_FOUND_MESSAGE,
  SESSION_DELETE_PHOTO_FAILED_MESSAGE,
} from '@/lib/session-delete';
import { COMPARABLE_SESSION_FETCH_LIMIT, COMPARABLE_SESSION_LIMIT } from '@/lib/session-compare';
import { MISSING_TRACK_MESSAGE, TRACK_NAME_MATCH_LIMIT } from '@/lib/session-track';
import type {
  CreateSessionInput,
  Session,
  SessionEnvironment,
  TelemetrySummary,
  VehicleBaseline,
} from '@/types';

/**
 * `code`, `details` and `hint` are optional because the code under test reads
 * them: an error with no `code` is what postgrest-js resolves a transport
 * failure as, and telling that apart from a database rejection is the whole
 * point of the paths these fixtures drive.
 */
type QueryError = {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

type QueryResponse = {
  base?: { data?: unknown; error?: QueryError | null; count?: number | null };
  single?: { data?: unknown; error?: QueryError | null };
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
  query.is = vi.fn(() => query);
  query.lt = vi.fn(() => query);
  query.lte = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.range = vi.fn(() => query);
  query.single = vi.fn(async () => single);
  query.maybeSingle = vi.fn(async () => single);
  query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(base).then(onFulfilled, onRejected);

  return query;
}

/**
 * The single `tracks` read a payload carrying a `track_id` costs.
 *
 * `resolveSessionTrack` resolves the id rather than trusting it, and returns as
 * soon as the row comes back, so a create from the fixture below opens with this
 * one query and no name lookup.
 */
function createTrackIdLookup(row: { id: string; name: string } = { id: 'track-1', name: 'MSR Cresson' }) {
  return createQuery({ single: { data: row, error: null } });
}

/** A uuid, as the database casts it: `createSession` refuses anything else. */
const VEHICLE_ID = '22222222-2222-4222-8222-222222222222';

const validInput: CreateSessionInput = {
  vehicle_id: VEHICLE_ID,
  // A session has to name the circuit it ran at, so the fixture the successful
  // paths below share names one: `createSession` refuses a payload that carries
  // neither an id nor a name. See lib/session-track.ts.
  track_id: 'track-1',
  track_name: 'MSR Cresson',
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
  vehicle_id: VEHICLE_ID,
  track_id: 'track-1',
  track_name: 'MSR Cresson',
  layout_id: null,
  layout_name: null,
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
  photo_url: null,
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
  vehicle_id: VEHICLE_ID,
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

/**
 * A client for `createSession`'s fault cases, routed by table rather than by
 * call order, so a change to how many reads track resolution makes cannot break
 * a test about something else. A table the test does not name answers every
 * read empty; the track id resolves to MSR Cresson and the vehicle is a
 * motorcycle. `create_session_with_laps` stores and echoes the row it was sent,
 * unless the test answers it with `createResult`.
 */
function createSaveClient({
  tables = {},
  createResult,
  trackTakeBackResult = { data: true, error: null },
}: {
  tables?: Record<string, () => ReturnType<typeof createQuery>>;
  createResult?: { data: unknown; error: QueryError | null };
  trackTakeBackResult?: { data: unknown; error: QueryError | null };
} = {}) {
  const defaults: Record<string, () => ReturnType<typeof createQuery>> = {
    tracks: () => createTrackIdLookup(),
    vehicles: () => createQuery({ single: { data: { type: 'motorcycle' }, error: null } }),
  };
  const from = vi.fn(
    (table: string) => (tables[table] ?? defaults[table] ?? (() => createQuery({ base: { data: [], error: null } })))(),
  );
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'delete_auto_created_track_if_unused') return trackTakeBackResult;
    expect(name).toBe('create_session_with_laps');
    return (
      createResult ?? {
        data: { replayed: false, session: { ...createdSession, ...(args.p_session as object), id: args.p_session_id } },
        error: null,
      }
    );
  });
  vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);
  return { from, rpc };
}

describe('sessions actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => undefined) } as never);
  });

  // Several tests below silence console.error with vi.spyOn so an expected
  // failure log does not clutter the run. Restoring it inline at the end of the
  // body meant a body that threw first left the spy installed, and console.error
  // was swallowed for every test after it - the next real failure then surfaced
  // with no message, far from its cause. This restores exactly that one spy, and
  // only when it is installed, rather than vi.restoreAllMocks(): on vitest 2 that
  // would also reset every bare vi.fn() module mock this file declares, which is
  // a broader change than the leak it closes.
  afterEach(() => {
    if (vi.isMockFunction(console.error)) {
      vi.mocked(console.error).mockRestore();
    }
  });

  // What a save does against the database - track resolution, layouts, the
  // free-plan cap, the vehicle check, atomicity and change records - is proven
  // against a real one in tests/db/create-session.spec.ts. What stays here is
  // what a real database cannot be made to do on cue: a read or a call that
  // fails, a lookup that comes back truncated, and the paths that must not
  // write anything at all.

  it('returns auth error when creating session while logged out', async () => {
    vi.mocked(getRealUser).mockResolvedValue(null);

    const result = await createSession(validInput);

    expect(result).toEqual({ ok: false, error: 'Not authenticated.' });
  });

  it('refuses a session whose weather the rider never answered', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const { rpc } = createSaveClient();

    const result = await createSession({
      ...validInput,
      conditions: null as unknown as CreateSessionInput['conditions'],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe(MISSING_CONDITIONS_MESSAGE);
    expect(rpc).not.toHaveBeenCalled();
  });

  // The Track field carried no validation while Vehicle and Date both did, so a
  // rider who scrolled past it saved a session that reads "Unknown Track" and
  // matches no other session at the same circuit, so every comparison against it
  // comes back flagged "Track mismatch" and weak (lib/session-compare.ts).
  // Reproduced against a real account: the form saved,
  // `track_id` and `track_name` both came back null, and the detail screen showed
  // a dash. The form checks this too; these are the cases that reach the action
  // anyway. See lib/session-track.ts.
  it('refuses a session that names no track, before touching a track', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const { from, rpc } = createSaveClient();

    const result = await createSession({ ...validInput, track_id: null, track_name: null });

    expect(result).toEqual({ ok: false, error: MISSING_TRACK_MESSAGE });
    // Refused on the payload, so no track row was written for a session that
    // never existed - which on the free plan would have spent a custom-track slot.
    expect(from).not.toHaveBeenCalledWith('tracks');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a track name that is only whitespace', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const { from, rpc } = createSaveClient();

    // `required` on the input counts a space as filled, so this is the spelling
    // the browser lets through.
    const result = await createSession({ ...validInput, track_id: null, track_name: '   ' });

    expect(result).toEqual({ ok: false, error: MISSING_TRACK_MESSAGE });
    expect(from).not.toHaveBeenCalledWith('tracks');
    expect(rpc).not.toHaveBeenCalled();
  });

  // The website form once wrote the row, its laps and its environment as three
  // statements and counted the free-plan cap in TypeScript beforehand, so a
  // form save racing a phone save at nine sessions stored eleven. It now makes
  // the phone's one call, which counts under the rider's lock.
  it('saves through create_session_with_laps under an id it mints per save, and never inserts the row itself', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'free' } as never);
    const sessions = createQuery({ base: { data: [], error: null } });
    const { rpc } = createSaveClient({ tables: { sessions: () => sessions } });
    const laps = [{ lap_number: 1, lap_time_ms: 142_300, included: true }];

    const first = await createSession({ ...validInput, laps });
    const second = await createSession(validInput);

    expect(first.ok && second.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
    const [firstArgs, secondArgs] = rpc.mock.calls.map(([, args]) => args);
    expect(firstArgs.p_session_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(secondArgs.p_session_id).not.toBe(firstArgs.p_session_id);
    expect(firstArgs.p_session).toMatchObject({ user_id: 'user-1', vehicle_id: VEHICLE_ID, track_id: 'track-1' });
    expect(firstArgs.p_laps).toEqual(laps);
    expect(first.ok && first.data.id).toBe(firstArgs.p_session_id);
    expect(sessions.insert).not.toHaveBeenCalled();
  });

  it('saves without looking for an earlier save first, since the id it mints names none', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const missing = { message: "Could not find the table 'public.deleted_sessions' in the schema cache", code: 'PGRST205' };
    const { from, rpc } = createSaveClient({
      tables: { deleted_sessions: () => createQuery({ single: { data: null, error: missing } }) },
    });

    const result = await createSession(validInput);

    expect(result.ok, !result.ok ? result.error : '').toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalledWith('deleted_sessions');
    expect(reportError).not.toHaveBeenCalled();
  });

  it('saves the session under the typed name when the alias lookup fails', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const tracks = createQuery({ base: { data: [], error: null } });
    const { rpc } = createSaveClient({
      tables: {
        tracks: () => tracks,
        track_aliases: () => createQuery({ base: { data: null, error: { message: 'boom' } } }),
      },
    });

    const result = await createSession({ ...validInput, track_id: null, track_name: 'Some New Circuit' });

    // A rider is never blocked by a lookup that could not answer - and a failed
    // lookup is not "no such circuit", so no track is created behind it either.
    expect(result.ok).toBe(true);
    expect(rpc.mock.calls[0][1].p_session).toMatchObject({ track_id: null, track_name: 'Some New Circuit' });
    expect(rpc.mock.calls[0][1].p_session).not.toHaveProperty('layout_id');
    expect(tracks.insert).not.toHaveBeenCalled();
  });

  it('creates no track when the name lookup came back full', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // A result set that reached the bound. None of these folds equal to the typed
    // name, but the rider's own row may be the one the bound cut off.
    const truncated = createQuery({
      base: {
        data: Array.from({ length: TRACK_NAME_MATCH_LIMIT }, (_, index) => ({
          id: `track-${index}`,
          name: `Other Circuit ${index}`,
        })),
        error: null,
      },
    });
    const { rpc } = createSaveClient({ tables: { tracks: () => truncated } });

    const result = await createSession({ ...validInput, track_id: null, track_name: 'Harris Hill Raceway' });

    // A truncated read is not evidence the circuit is new. The session saves under
    // the typed name, which every read surface still matches, rather than spending
    // a custom-track slot on a row the rider may already have.
    expect(result.ok).toBe(true);
    expect(rpc.mock.calls[0][1].p_session).toMatchObject({ track_id: null, track_name: 'Harris Hill Raceway' });
    expect(truncated.insert).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      '[sessions] visible tracks lookup truncated',
      expect.objectContaining({ userId: 'user-1', trackName: 'Harris Hill Raceway', limit: TRACK_NAME_MATCH_LIMIT }),
    );
  });

  it('still saves the session when the track row cannot be created', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const tracks = createQuery({
      base: { data: [], error: null },
      single: { data: null, error: { message: 'insert refused' } },
    });
    const { rpc } = createSaveClient({ tables: { tracks: () => tracks } });

    const result = await createSession({ ...validInput, track_id: null, track_name: 'Harris Hill Raceway' });

    expect(result.ok).toBe(true);
    expect(tracks.insert).toHaveBeenCalled();
    expect(rpc.mock.calls[0][1].p_session).toMatchObject({ track_id: null, track_name: 'Harris Hill Raceway' });
  });

  it('refuses the save, and reports it, when the layout lookup fails', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const { rpc } = createSaveClient({
      tables: {
        track_layouts: () => createQuery({ single: { data: null, error: { message: 'connection reset', code: '08006' } } }),
      },
    });

    const result = await createSession({ ...validInput, layout_id: 'layout-13' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not saved/);
    // A failed read is not "no such layout": nothing is saved with the rider's
    // choice silently dropped.
    expect(rpc).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(
      'session-layout',
      expect.any(Error),
      expect.objectContaining({ table: 'track_layouts' }),
    );
  });

  describe('a create the database could not complete', () => {
    /** A typed circuit the rider has never logged, so this save creates its track row. */
    function newCircuitTracks() {
      return createQuery({
        base: { data: [], error: null },
        single: { data: { id: 'track-new', name: 'Harris Hill Raceway' }, error: null },
      });
    }

    it('does not show the rider raw PostgREST, reports it, and takes back the track it made', async () => {
      vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
      vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
      const tracks = newCircuitTracks();
      const { rpc } = createSaveClient({
        tables: { tracks: () => tracks },
        createResult: {
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Could not find the function public.create_session_with_laps in the schema cache',
            details: null,
            hint: null,
          },
        },
      });

      const result = await createSession({ ...validInput, track_id: null, track_name: 'Harris Hill Raceway' });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).not.toContain('schema cache');
      expect(!result.ok && result.error).toMatch(/on our end/i);
      expect(reportError).toHaveBeenCalledWith(
        'session-create',
        expect.objectContaining({ message: expect.stringContaining('schema cache') }),
        expect.objectContaining({ reason: 'PGRST202', query: 'create_session_with_laps' }),
      );
      // A database that answered with a code rolled the whole call back, so the
      // track resolved for it is unused - and the database decides whether it
      // still is, since another save may have stored a session against it since.
      expect(rpc).toHaveBeenCalledWith('delete_auto_created_track_if_unused', { p_track_id: 'track-new' });
      expect(tracks.delete).not.toHaveBeenCalled();
    });

    it('reports a take-back of its track that failed, and still tells the rider why the save was refused', async () => {
      vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
      vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'free' } as never);
      createSaveClient({
        tables: { tracks: () => newCircuitTracks() },
        createResult: { data: null, error: { code: 'TT402', message: 'the free plan holds 10 sessions' } },
        trackTakeBackResult: {
          data: null,
          error: { code: 'PGRST202', message: 'Could not find the function public.delete_auto_created_track_if_unused' },
        },
      });

      const result = await createSession({ ...validInput, track_id: null, track_name: 'Harris Hill Raceway' });

      expect(result).toEqual({ ok: false, error: getFreePlanLimitMessage('sessions') });
      expect(reportError).toHaveBeenCalledWith(
        'session-track-rollback',
        expect.any(Error),
        expect.objectContaining({ reason: 'PGRST202', trackId: 'track-new' }),
      );
    });

    it('does not show the rider a transport failure, and keeps the track the save may have used', async () => {
      vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
      vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
      const tracks = newCircuitTracks();
      const { rpc } = createSaveClient({
        tables: { tracks: () => tracks },
        createResult: { data: null, error: { code: '', message: 'TypeError: fetch failed', details: '', hint: '' } },
      });

      const result = await createSession({ ...validInput, track_id: null, track_name: 'Harris Hill Raceway' });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).not.toContain('fetch failed');
      // The call may have committed, so the rider is sent to look rather than promised a clean slate.
      expect(!result.ok && result.error).toMatch(/may not have saved/i);
      expect(reportError).toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalledWith('delete_auto_created_track_if_unused', expect.anything());
    });
  });

  it('still succeeds when the change-record insert fails', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createSaveClient({
      tables: {
        sessions: () => createQuery({ base: { data: [previousSession], error: null } }),
        vehicle_baselines: () => createQuery({ base: { data: [changeBaseline], error: null } }),
        session_changes: () => createQuery({ base: { data: null, error: { message: 'changes failed' } } }),
      },
    });

    const result = await createSession(validInput);

    expect(result.ok).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      '[sessions] session_changes insert failed',
      expect.objectContaining({ userId: 'user-1', error: 'changes failed' }),
    );
  });

  it('skips persisting change records when the vehicle type cannot be resolved', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { from } = createSaveClient({
      tables: {
        vehicles: () => createQuery({ single: { data: null, error: { message: 'not found' } } }),
        sessions: () => createQuery({ base: { data: [previousSession], error: null } }),
        vehicle_baselines: () => createQuery({ base: { data: [changeBaseline], error: null } }),
      },
    });

    const result = await createSession(validInput);

    expect(result.ok).toBe(true);
    expect(from).not.toHaveBeenCalledWith('session_changes');
    expect(errorSpy).toHaveBeenCalledWith(
      '[sessions] session_changes skipped: unresolved vehicle type',
      expect.objectContaining({ userId: 'user-1', vehicleId: VEHICLE_ID }),
    );
  });

  it('returns the closest previous session for same day and earlier time', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

    const current: Session = {
      id: 'current',
      user_id: 'user-1',
      vehicle_id: VEHICLE_ID,
      track_id: null,
      track_name: null,
      layout_id: null,
      layout_name: null,
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
      photo_url: null,
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
      vehicle_id: VEHICLE_ID,
      track_id: 'track-1',
      track_name: 'MSR Cresson',
      layout_id: null,
      layout_name: null,
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
      photo_url: null,
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
        vehicle_id: VEHICLE_ID,
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

  /**
   * A discarded read renders as `Laps 0` and "No lap times logged yet." on the
   * Pro analytics panel, which is exactly what a rider who logged no laps sees.
   * Nobody can act on a failure nothing records, so the degraded answer has to
   * say so - the same rule `fetchPreviousSession` follows.
   */
  it('says so when the telemetry query fails rather than reading as no laps', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

    const telemetryQuery = createQuery({
      base: { data: null, error: { message: 'permission denied for table telemetry_summaries' } },
    });
    const from = vi.fn(() => telemetryQuery);
    vi.mocked(createClient).mockResolvedValue({ from, rpc: vi.fn(async () => ({ data: null, error: null })) } as never);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await getTelemetrySummaries(['session-1', 'session-2']);

    expect(result).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith('[sessions] telemetry-summaries query failed', {
      userId: 'user-1',
      sessionCount: 2,
      error: 'permission denied for table telemetry_summaries',
    });
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

    const result = await replaceSessionLaps('session-1', [], []);

    expect(result).toEqual({ ok: false, error: 'snapshot failed' });
    expect(rpc).not.toHaveBeenCalled();
  });

  // A code-less error is a transport failure or an unparseable body, not the
  // function talking. It used to reach the rider verbatim.
  it('does not show the rider a lap error the function did not raise', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const sessionQuery = createQuery({
      single: { data: createdSession, error: null },
    });
    const from = vi.fn(() => sessionQuery);
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'lap transaction failed' } }));
    vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);

    const readLaps = [
      { lap_number: 1, lap_time_ms: 90_000, included: true },
      { lap_number: 2, lap_time_ms: 91_000, included: false },
    ];

    const result = await replaceSessionLaps('sess-1', [], readLaps);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).not.toContain('lap transaction failed');
    expect(!result.ok && result.error).toMatch(/not saved/i);
    expect(rpc).toHaveBeenCalledWith('replace_session_laps', {
      p_user_id: 'user-1',
      p_session_id: 'sess-1',
      p_laps: [],
      p_expected_laps: readLaps,
    });
  });

  /**
   * The whole point of sending the rows rather than their number. A count cannot
   * describe an edit that leaves the count alone, so the caller has to hand the
   * database the `included` flags and lap times it read for the guard in
   * 20260903001500 to have anything to compare. Whether the database then
   * refuses is its business and is covered in
   * `tests/e2e/session-laps-stale-read-guard.spec.ts`; what this pins is that
   * the belief travels at all.
   */
  it('sends the lap times and inclusion flags it read, not how many there were', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const from = vi.fn(() => createQuery({ single: { data: createdSession, error: null } }));
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);

    const readLaps = [
      { lap_number: 1, lap_time_ms: 90_000, included: true },
      { lap_number: 2, lap_time_ms: 91_000, included: true },
    ];
    // Same count, different content: only the second lap's flag moved.
    const edited = [readLaps[0], { ...readLaps[1], included: false }];

    const result = await replaceSessionLaps('sess-1', edited, readLaps);

    expect(result.ok).toBe(true);
    // The two lists are the same length, so a count could not have told the
    // database these are different sets. The flags are what carry it.
    expect(rpc).toHaveBeenCalledWith(
      'replace_session_laps',
      expect.objectContaining({ p_laps: edited, p_expected_laps: readLaps }),
    );
  });


  /**
   * The read failing and the session holding no laps have to stay two different
   * answers, all the way to the panel. Flattened into one they cost the rider
   * their lap times: the panel reads an empty list as "no laps yet", offers "Add
   * Lap Times", and the save behind it replaces the whole set. Against the code
   * this fixes, the first of these got `[]` back and passed nothing to fail on.
   */
  it('reports a failed lap read instead of answering with no laps', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const from = vi.fn(() => createQuery({
      base: { data: null, error: { message: 'permission denied for table session_laps' } },
    }));
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await getSessionLaps('session-1');

    expect(result).toEqual({ ok: false, error: 'permission denied for table session_laps' });
  });

  it('answers with no laps only when the read actually succeeded', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const from = vi.fn(() => createQuery({ base: { data: [], error: null } }));
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await getSessionLaps('session-1');

    expect(result).toEqual({ ok: true, data: [] });
  });

  it('reports a lap read it cannot attribute to a rider as a failure', async () => {
    vi.mocked(getRealUser).mockResolvedValue(null);

    const result = await getSessionLaps('session-1');

    expect(result).toEqual({ ok: false, error: 'Not authenticated.' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('tells the rider a stale save was refused rather than repeating the database', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const sessionQuery = createQuery({ single: { data: createdSession, error: null } });
    const from = vi.fn(() => sessionQuery);
    const rpc = vi.fn(async () => ({
      data: null,
      error: {
        code: 'TT409',
        message: 'replace_session_laps stale read: the stored laps (12) are not the ones the caller read (12)',
      },
    }));
    vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);

    const result = await replaceSessionLaps('sess-1', [], []);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('changed since this page loaded');
    expect(!result.ok && result.error).not.toContain('replace_session_laps');
    // Not a fault: the guard did its job and the rider has something to do.
    expect(reportError).not.toHaveBeenCalled();
  });

  // THE SIBLING OF THE SAVE OUTCOME DEFECT. `replace_session_laps` unresolvable
  // in production printed raw PostgREST parameter names under lap times that
  // were not saved, with nothing reaching Sentry or the log drain.
  it('does not show the rider raw PostgREST when the lap RPC cannot be resolved', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const sessionQuery = createQuery({ single: { data: createdSession, error: null } });
    const from = vi.fn(() => sessionQuery);
    const rpc = vi.fn(async () => ({
      data: null,
      error: {
        code: 'PGRST202',
        message:
          'Could not find the function public.replace_session_laps(p_expected_laps, p_laps, p_session_id, p_user_id) in the schema cache',
        details: null,
        hint: null,
      },
    }));
    vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);

    const result = await replaceSessionLaps('sess-1', [], []);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).not.toContain('replace_session_laps');
    expect(!result.ok && result.error).not.toContain('schema cache');
    // The lap-only sentence, because only the laps were at stake here.
    expect(!result.ok && result.error).toMatch(/lap times were not saved/i);
    expect(!result.ok && result.error).toMatch(/on our end/i);
    expect(!result.ok && result.error).toMatch(/copy them somewhere safe/i);
    expect(reportError).toHaveBeenCalledWith(
      'session-laps',
      expect.objectContaining({ message: expect.stringContaining('schema cache') }),
      expect.objectContaining({ reason: 'PGRST202', query: 'replace_session_laps' }),
    );
  });

  // A transport failure never reaches Postgres, and postgrest-js resolves it as
  // an ordinary error carrying an EMPTY code.
  it('does not show the rider a transport failure on the lap path', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const sessionQuery = createQuery({ single: { data: createdSession, error: null } });
    const from = vi.fn(() => sessionQuery);
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: '', message: 'TypeError: fetch failed', details: '', hint: '' },
    }));
    vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);

    const result = await replaceSessionLaps('sess-1', [], []);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).not.toContain('fetch failed');
    expect(!result.ok && result.error).toMatch(/not saved/i);
    expect(reportError).toHaveBeenCalled();
  });

  // The function's own domain rejections still reach the rider unchanged: they
  // are about this request and tell them what to change.
  it('passes a lap domain rejection through unchanged', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const sessionQuery = createQuery({ single: { data: createdSession, error: null } });
    const from = vi.fn(() => sessionQuery);
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: 'P0001', message: 'sessions cannot exceed 200 laps' },
    }));
    vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);

    const result = await replaceSessionLaps('sess-1', [], []);

    expect(result).toEqual({ ok: false, error: 'sessions cannot exceed 200 laps' });
    expect(reportError).not.toHaveBeenCalled();
  });

  it('returns demo telemetry summaries without calling Supabase', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => ({ value: '1', name: DEMO_COOKIE_NAME })) } as never);

    const result = await getTelemetrySummaries(['demo-session-4']);

    expect(result).toHaveLength(1);
    expect(result[0]?.session_id).toBe('demo-session-4');
    expect(createClient).not.toHaveBeenCalled();
  });

  describe('deleteSession', () => {
    const OWN_PHOTO = 'https://project.supabase.co/storage/v1/object/public/session-photos/user-1/sess-1.jpg';

    /**
     * The two statements a delete makes, in order: the read of the row and its
     * photo, then the guarded delete. `remove` is Storage's answer; `events`
     * records what happened in which order, so "photo first" is asserted rather
     * than assumed.
     */
    function sessionDeleteClient({
      row,
      readError = null,
      deleted = [{ id: 'sess-1' }],
      deleteError = null,
      remove = vi.fn(async (paths: string[]) => ({ data: paths.map((name) => ({ name })), error: null })),
    }: {
      row: { id: string; photo_url: string | null } | null;
      readError?: QueryError | null;
      deleted?: { id: string }[];
      deleteError?: QueryError | null;
      remove?: ReturnType<typeof vi.fn>;
    }) {
      const events: string[] = [];
      const readQuery = createQuery({ single: { data: row, error: readError } });
      const deleteQuery = createQuery({ base: { data: deleteError ? null : deleted, error: deleteError } });
      deleteQuery.delete = vi.fn(() => {
        events.push('delete row');
        return deleteQuery;
      });
      const queries = [readQuery, deleteQuery];
      const from = vi.fn(() => {
        const next = queries.shift();
        if (!next) throw new Error('unexpected query on sessions');
        return next;
      });
      const trackedRemove = vi.fn(async (paths: string[]) => {
        events.push('remove photo');
        return remove(paths);
      });
      const storageFrom = vi.fn(() => ({ remove: trackedRemove }));
      vi.mocked(createClient).mockResolvedValue({ from, storage: { from: storageFrom } } as never);
      return { from, readQuery, deleteQuery, remove: trackedRemove, storageFrom, events };
    }

    beforeEach(() => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
      vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    });

    it('deletes only the caller own session and refreshes the screens that list it', async () => {
      const { from, readQuery, deleteQuery, remove, events } = sessionDeleteClient({
        row: { id: 'sess-1', photo_url: null },
      });

      const result = await deleteSession('sess-1');

      expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: false } });
      expect(from).toHaveBeenCalledWith('sessions');
      expect(readQuery.eq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(deleteQuery.delete).toHaveBeenCalled();
      expect(deleteQuery.eq).toHaveBeenCalledWith('id', 'sess-1');
      expect(deleteQuery.eq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(deleteQuery.is).toHaveBeenCalledWith('photo_url', null);
      expect(events).toEqual(['delete row', 'remove photo']);
      expect(remove).toHaveBeenCalledWith(['user-1/sess-1.jpg']);
      expect(revalidatePath).toHaveBeenCalledWith('/sessions');
      expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
      expect(revalidatePath).toHaveBeenCalledWith('/sessions/sess-1');
    });

    it('removes the photo from the public bucket first, then deletes the row', async () => {
      const { deleteQuery, remove, storageFrom, events } = sessionDeleteClient({
        row: { id: 'sess-1', photo_url: OWN_PHOTO },
      });

      const result = await deleteSession('sess-1');

      expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: false } });
      expect(storageFrom).toHaveBeenCalledWith('session-photos');
      expect(remove).toHaveBeenCalledWith(['user-1/sess-1.jpg']);
      expect(events).toEqual(['remove photo', 'delete row', 'remove photo']);
      expect(deleteQuery.eq).toHaveBeenCalledWith('photo_url', OWN_PHOTO);
      expect(reportError).not.toHaveBeenCalled();
    });

    it('keeps the session and tells the rider to try again when storage refuses to remove the photo', async () => {
      const { deleteQuery, events } = sessionDeleteClient({
        row: { id: 'sess-1', photo_url: OWN_PHOTO },
        remove: vi.fn(async () => ({ data: null, error: { message: 'storage down' } })),
      });

      const result = await deleteSession('sess-1');

      expect(result).toEqual({ ok: false, error: SESSION_DELETE_PHOTO_FAILED_MESSAGE });
      expect(deleteQuery.delete).not.toHaveBeenCalled();
      expect(events).toEqual(['remove photo']);
      expect(reportError).toHaveBeenCalledWith(
        'session-photo-delete',
        expect.any(Error),
        expect.objectContaining({ bucket: 'session-photos', object: 'user-1/sess-1.jpg', sessionId: 'sess-1' }),
      );
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('keeps the session when the storage call throws', async () => {
      const { deleteQuery } = sessionDeleteClient({
        row: { id: 'sess-1', photo_url: OWN_PHOTO },
        remove: vi.fn(async () => {
          throw new Error('network gone');
        }),
      });

      const result = await deleteSession('sess-1');

      expect(result).toEqual({ ok: false, error: SESSION_DELETE_PHOTO_FAILED_MESSAGE });
      expect(deleteQuery.delete).not.toHaveBeenCalled();
    });

    it('deletes the row when the photo is already gone from storage', async () => {
      // `remove` reports what it deleted, so an object already absent comes back
      // missing rather than as an error - nothing is left to serve.
      const { deleteQuery } = sessionDeleteClient({
        row: { id: 'sess-1', photo_url: OWN_PHOTO },
        remove: vi.fn(async () => ({ data: [], error: null })),
      });

      const result = await deleteSession('sess-1');

      expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: false } });
      expect(deleteQuery.delete).toHaveBeenCalled();
    });

    it("leaves another rider's photo alone and still deletes the row", async () => {
      const foreign = 'https://project.supabase.co/storage/v1/object/public/session-photos/user-2/sess-1.jpg';
      const { deleteQuery, remove } = sessionDeleteClient({ row: { id: 'sess-1', photo_url: foreign } });

      const result = await deleteSession('sess-1');

      expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: false } });
      expect(remove.mock.calls).toEqual([[['user-1/sess-1.jpg']]]);
      expect(deleteQuery.delete).toHaveBeenCalled();
      expect(reportError).toHaveBeenCalledWith(
        'session-photo-delete',
        expect.any(Error),
        expect.objectContaining({ photoUrl: foreign, sessionId: 'sess-1' }),
      );
    });

    describe('a phone uploading to the photo path while the session is deleted', () => {
      // The bucket as Storage holds it: `remove` deletes what is there and
      // reports it, and the phone's upload lands while the row delete runs.
      function deleteWithUploadDuring(row: { id: string; photo_url: string | null }, bucket: Set<string>) {
        const client = sessionDeleteClient({
          row,
          remove: vi.fn(async (paths: string[]) => ({
            data: paths.filter((path) => bucket.delete(path)).map((name) => ({ name })),
            error: null,
          })),
        });
        client.deleteQuery.delete = vi.fn(() => {
          client.events.push('delete row');
          bucket.add('user-1/sess-1.jpg');
          return client.deleteQuery;
        });
        return client;
      }

      it('removes a replacement uploaded under the same URL after the first removal', async () => {
        const bucket = new Set(['user-1/sess-1.jpg']);
        const { events } = deleteWithUploadDuring({ id: 'sess-1', photo_url: OWN_PHOTO }, bucket);

        const result = await deleteSession('sess-1');

        expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: false } });
        expect(events).toEqual(['remove photo', 'delete row', 'remove photo']);
        expect(bucket.size).toBe(0);
        expect(reportError).not.toHaveBeenCalled();
      });

      it('removes a first photo uploaded to a session that had none when it was read', async () => {
        const bucket = new Set<string>();
        deleteWithUploadDuring({ id: 'sess-1', photo_url: null }, bucket);

        const result = await deleteSession('sess-1');

        expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: false } });
        expect(bucket.size).toBe(0);
        expect(reportError).not.toHaveBeenCalled();
      });

      it('keeps the delete and says so when the removal after it fails', async () => {
        sessionDeleteClient({
          row: { id: 'sess-1', photo_url: null },
          remove: vi.fn(async () => ({ data: null, error: { message: 'storage down' } })),
        });

        const result = await deleteSession('sess-1');

        expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: true } });
        expect(reportError).toHaveBeenCalledWith(
          'session-photo-delete',
          expect.any(Error),
          expect.objectContaining({ bucket: 'session-photos', object: 'user-1/sess-1.jpg', sessionId: 'sess-1' }),
        );
        expect(revalidatePath).toHaveBeenCalledWith('/sessions');
      });
    });

    it('refuses when a new photo reached the session between the removal and the delete', async () => {
      // The delete matches only the photo that was just removed, so a photo the
      // phone synced in between leaves the row in place rather than orphaned.
      const { deleteQuery } = sessionDeleteClient({ row: { id: 'sess-1', photo_url: null }, deleted: [] });

      const result = await deleteSession('sess-1');

      expect(result).toEqual({ ok: false, error: SESSION_DELETE_CHANGED_MESSAGE });
      expect(deleteQuery.is).toHaveBeenCalledWith('photo_url', null);
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('does not tell the rider nothing was deleted once the photo is gone and the session changed', async () => {
      const { events } = sessionDeleteClient({ row: { id: 'sess-1', photo_url: OWN_PHOTO }, deleted: [] });

      const result = await deleteSession('sess-1');

      expect(result).toEqual({ ok: false, error: SESSION_DELETE_CHANGED_AFTER_PHOTO_MESSAGE });
      expect(events).toEqual(['remove photo', 'delete row']);
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('does not tell the rider nothing was removed once the photo is gone and the delete fails', async () => {
      sessionDeleteClient({
        row: { id: 'sess-1', photo_url: OWN_PHOTO },
        deleteError: { message: 'permission denied for table sessions', code: '42501' },
      });

      const result = await deleteSession('sess-1');

      expect(result).toEqual({ ok: false, error: SESSION_DELETE_FAILED_AFTER_PHOTO_MESSAGE });
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('reports a failure when no session of the caller has that id', async () => {
      // RLS plus the user_id filter make another rider's id read as no row rather
      // than an error.
      const { from, storageFrom } = sessionDeleteClient({ row: null });

      const result = await deleteSession('someone-elses-session');

      expect(result).toEqual({ ok: false, error: SESSION_DELETE_NOT_FOUND_MESSAGE });
      expect(from).toHaveBeenCalledTimes(1);
      expect(storageFrom).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('tells the rider nothing was removed when the read fails', async () => {
      const { from, storageFrom } = sessionDeleteClient({
        row: null,
        readError: { message: 'permission denied for table sessions', code: '42501' },
      });

      const result = await deleteSession('sess-1');

      expect(result).toEqual({ ok: false, error: SESSION_DELETE_FAILED_MESSAGE });
      expect(from).toHaveBeenCalledTimes(1);
      expect(storageFrom).not.toHaveBeenCalled();
      expect(reportError).toHaveBeenCalledWith(
        'session-delete',
        expect.any(Error),
        expect.objectContaining({ reason: '42501', table: 'sessions' }),
      );
    });

    it('tells the rider nothing was removed and reports the error when the delete fails', async () => {
      sessionDeleteClient({
        row: { id: 'sess-1', photo_url: null },
        deleteError: { message: 'permission denied for table sessions', code: '42501' },
      });

      const result = await deleteSession('sess-1');

      // The database's own words are for the log, not the rider.
      expect(result).toEqual({ ok: false, error: SESSION_DELETE_FAILED_MESSAGE });
      expect(reportError).toHaveBeenCalledWith(
        'session-delete',
        expect.any(Error),
        expect.objectContaining({ reason: '42501', table: 'sessions' }),
      );
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  it('refuses to delete a session in demo mode', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => ({ value: '1', name: DEMO_COOKIE_NAME })) } as never);

    const result = await deleteSession('demo-session-4');

    expect(result.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns auth error when deleting a session while logged out', async () => {
    vi.mocked(getRealUser).mockResolvedValue(null);

    const result = await deleteSession('sess-1');

    expect(result).toEqual({ ok: false, error: 'Not authenticated.' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('lists the sessions at a track by id and by an unlinked matching name, newest first', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const linked = { id: 's-linked', track_id: 'track-1', track_name: 'Barber', date: '2026-05-01', start_time: null, created_at: '2026-05-01T10:00:00Z' };
    const legacy = { id: 's-legacy', track_id: null, track_name: 'barber ', date: '2026-06-01', start_time: null, created_at: '2026-06-01T10:00:00Z' };
    const otherCircuit = { id: 's-other', track_id: null, track_name: 'Barber North', date: '2026-07-01', start_time: null, created_at: '2026-07-01T10:00:00Z' };
    const byId = createQuery({ base: { data: [linked], error: null } });
    // The name read is a wildcard narrowing, so it can return a circuit the fold rejects.
    const byName = createQuery({ base: { data: [legacy, otherCircuit], error: null } });
    const from = vi.fn().mockReturnValueOnce(byId).mockReturnValueOnce(byName);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await getSessionsAtTrack({ id: 'track-1', name: 'Barber' });

    expect(result.ok && result.data.map((session) => session.id)).toEqual(['s-legacy', 's-linked']);
    expect(byId.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(byId.eq).toHaveBeenCalledWith('track_id', 'track-1');
    expect(byName.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('lists only the most recent sessions at a track', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const session = (id: string, trackId: string | null, date: string) => ({
      id,
      track_id: trackId,
      track_name: 'Barber',
      date,
      start_time: null,
      created_at: `${date}T10:00:00Z`,
    });
    const linked = Array.from({ length: 10 }, (_, index) =>
      session(`s-linked-${index}`, 'track-1', `2026-05-${String(20 - index).padStart(2, '0')}`),
    );
    const legacy = [session('s-legacy-new', null, '2026-06-01'), session('s-legacy-old', null, '2025-01-01')];
    const byId = createQuery({ base: { data: linked, error: null } });
    const byName = createQuery({ base: { data: legacy, error: null } });
    vi.mocked(createClient).mockResolvedValue({
      from: vi.fn().mockReturnValueOnce(byId).mockReturnValueOnce(byName),
    } as never);

    const result = await getSessionsAtTrack({ id: 'track-1', name: 'Barber' });

    expect(byId.limit).toHaveBeenCalledWith(10);
    expect(result.ok && result.data.map((row) => row.id)).toEqual([
      's-legacy-new',
      ...linked.slice(0, 9).map((row) => row.id),
    ]);
  });

  it('pages the unlinked name read past rows the fold rejects instead of losing a real match', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const otherCircuit = Array.from({ length: 100 }, (_, index) => ({
      id: `s-other-${index}`,
      track_id: null,
      track_name: 'Barber North',
      date: '2026-07-01',
      start_time: null,
      created_at: '2026-07-01T10:00:00Z',
    }));
    const real = { id: 's-real', track_id: null, track_name: 'Barber', date: '2026-01-01', start_time: null, created_at: '2026-01-01T10:00:00Z' };
    const byId = createQuery({ base: { data: [], error: null } });
    const firstPage = createQuery({ base: { data: otherCircuit, error: null } });
    const secondPage = createQuery({ base: { data: [real], error: null } });
    vi.mocked(createClient).mockResolvedValue({
      from: vi.fn().mockReturnValueOnce(byId).mockReturnValueOnce(firstPage).mockReturnValueOnce(secondPage),
    } as never);

    const result = await getSessionsAtTrack({ id: 'track-1', name: 'Barber' });

    expect(result.ok && result.data.map((row) => row.id)).toEqual(['s-real']);
    expect(firstPage.range).toHaveBeenCalledWith(0, 99);
    expect(secondPage.range).toHaveBeenCalledWith(100, 199);
  });

  it('reports a failed track-sessions read rather than an empty history', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const byId = createQuery({ base: { data: null, error: { message: 'boom', code: '500' } } });
    const byName = createQuery({ base: { data: [], error: null } });
    vi.mocked(createClient).mockResolvedValue({
      from: vi.fn().mockReturnValueOnce(byId).mockReturnValueOnce(byName),
    } as never);

    const result = await getSessionsAtTrack({ id: 'track-1', name: 'Barber' });

    expect(result.ok).toBe(false);
    expect(reportError).toHaveBeenCalled();
  });

  // Both reads feed the session delete confirmation, which used to read a
  // failed query as "nothing of this kind to lose".
  it('reports a failed weather read instead of saying the session has none', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const query = createQuery({ base: { data: null, error: { message: 'boom' } } });
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn(() => query) } as never);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(getSessionEnvironment('sess-1')).resolves.toEqual({ ok: false, error: 'boom' });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('returns a successful empty weather read as null data, not a failure', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const query = createQuery({ base: { data: [], error: null } });
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn(() => query) } as never);

    await expect(getSessionEnvironment('sess-1')).resolves.toEqual({ ok: true, data: null });
  });

  it('reports a failed outcome read instead of saying the session has none', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const query = createQuery({ single: { data: null, error: { message: 'boom' } } });
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn(() => query) } as never);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(getSessionOutcome('sess-1')).resolves.toEqual({ ok: false, error: 'boom' });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('returns a session with no outcome as null data, not a failure', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const query = createQuery({ single: { data: null, error: null } });
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn(() => query) } as never);

    await expect(getSessionOutcome('sess-1')).resolves.toEqual({ ok: true, data: null });
  });

  // A console.error spy is installed inline by several tests above and, before
  // the afterEach at the top of this describe, restored inline too. A body that
  // threw between the two left the spy in place, so console.error was swallowed
  // for every test that ran afterwards and the next real failure surfaced with
  // no message, far from its cause. `it.fails` expects this body to throw; the
  // test after it is the guarantee that the throw did not leak the spy.
  it.fails('deliberately throws after installing a console.error spy', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    throw new Error('simulated test-body failure');
  });

  it('still sees the real console.error after the previous test threw', () => {
    expect(vi.isMockFunction(console.error)).toBe(false);
  });
});
