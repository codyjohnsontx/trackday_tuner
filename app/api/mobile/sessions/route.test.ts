import { randomUUID } from 'node:crypto';
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveUserAccess } from '@/lib/access';
import { getFreePlanLimit, getFreePlanLimitMessage } from '@/lib/plans';
import { MISSING_CONDITIONS_MESSAGE } from '@/lib/session-answers';
import { SESSION_REFERENCE_GONE_MESSAGE } from '@/lib/sessions/create';
import type { Profile } from '@/types';

/**
 * The route with everything real except Supabase: the bearer helper, the body
 * parser, `createSessionForUser` and its rules all run. Supabase is an in-memory
 * fake that honours the `eq` filters the create path writes, so a replay, a cap
 * and a stored row are read back out of the same table the route wrote to.
 */

const { createClient, reportError } = vi.hoisted(() => ({
  createClient: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@supabase/supabase-js')>()),
  createClient,
}));
vi.mock('@/lib/monitoring/report-error', () => ({ reportError }));

import { OPTIONS, POST } from '@/app/api/mobile/sessions/route';

const TOKEN = 'rider-access-token';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const VEHICLE_ID = '22222222-2222-4222-8222-222222222222';
const TRACK_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const WEB_ORIGIN = 'https://app.tracktuner.example';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

interface FakeOptions {
  /** How GoTrue answers `getUser`. Defaults to accepting TOKEN only. */
  getUser?: (token: string) => Promise<unknown>;
  /** Runs as `create_session_with_laps` starts, with the row it was sent - used to stage a race. */
  beforeSessionInsert?: (row: Row) => void;
  /** Make every `profiles` read fail. */
  profileReadFails?: boolean;
  /** Asked on each non-count `sessions` read; true fails that read in transit. */
  sessionReadFails?: () => boolean;
  /**
   * How a transport failure meets `create_session_with_laps`: `before` it ran,
   * so nothing was stored, or `after` it committed, so everything was and only
   * the answer was lost. Called once per call, so a retry can succeed.
   */
  createTransportFailure?: () => 'before' | 'after' | null;
}

const TRANSPORT_ERROR = { code: '', message: 'fetch failed' };

class Query {
  private op: 'select' | 'insert' | 'delete' = 'select';
  private filters: Array<[string, unknown]> = [];
  private likes: Array<[string, RegExp]> = [];
  private rows: Row[] = [];
  private head = false;
  private returning = false;

  constructor(
    private db: Db,
    private table: string,
    private options: FakeOptions,
  ) {}

  select(_columns?: string, opts?: { head?: boolean }) {
    if (this.op === 'select') this.head = Boolean(opts?.head);
    else this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert';
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }
  // A LIKE pattern as `findVisibleTrackByName` writes it: `\` escapes, `%` and `_` are wildcards.
  ilike(column: string, pattern: string) {
    const literal = (char: string) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let source = '';
    for (let index = 0; index < pattern.length; index += 1) {
      const char = pattern[index];
      if (char === '\\') source += literal(pattern[++index] ?? '');
      else if (char === '%') source += '.*';
      else if (char === '_') source += '.';
      else source += literal(char);
    }
    this.likes.push([column, new RegExp(`^${source}$`, 'i')]);
    return this;
  }
  // Filters the create path uses that this fake does not model. `or` is the
  // seeded-or-own visibility rule, which every row here already satisfies.
  or() { return this; }
  order() { return this; }
  lt() { return this; }
  limit() { return this; }

  private matching(): Row[] {
    return (this.db[this.table] ??= []).filter(
      (row) =>
        this.filters.every(([c, v]) => row[c] === v) &&
        this.likes.every(([c, like]) => typeof row[c] === 'string' && like.test(row[c] as string)),
    );
  }

  private run(): { data: unknown; error: unknown; count?: number } {
    if (this.table === 'profiles' && this.options.profileReadFails) {
      return { data: null, error: TRANSPORT_ERROR };
    }
    const table = (this.db[this.table] ??= []);
    if (this.op === 'insert') {
      const written = this.rows.map((input) => ({ id: randomUUID(), ...input }));
      table.push(...written);
      return { data: this.returning ? written : null, error: null };
    }
    if (this.op === 'delete') {
      const gone = this.matching();
      this.db[this.table] = table.filter((row) => !gone.includes(row));
      return { data: gone, error: null };
    }
    if (this.table === 'sessions' && !this.head && this.options.sessionReadFails?.()) {
      return { data: null, error: TRANSPORT_ERROR };
    }
    const rows = this.matching();
    return this.head ? { data: null, error: null, count: rows.length } : { data: rows, error: null };
  }

  async single() {
    const { data, error } = this.run();
    const rows = data as Row[] | null;
    if (error) return { data: null, error };
    if (!rows || rows.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'not one row' } };
    return { data: rows[0], error: null };
  }
  async maybeSingle() {
    const { data, error } = this.run();
    if (error) return { data: null, error };
    return { data: (data as Row[])[0] ?? null, error: null };
  }
  then<T>(resolve: (value: { data: unknown; error: unknown; count?: number }) => T, reject?: (reason: unknown) => T) {
    try {
      return Promise.resolve(resolve(this.run()));
    } catch (error) {
      return reject ? Promise.resolve(reject(error)) : Promise.reject(error);
    }
  }
}

/**
 * `create_session_with_laps` (20260927002200, 20260928002300) as the database
 * runs it: one transaction, so it answers with everything written or nothing
 * written, and in the function's order - replay, deleted replay, the free-plan
 * cap, the vehicle. The body runs without yielding, which is what the real
 * function's per-rider lock gives two calls from one rider.
 */
function createSessionWithLaps(db: Db, options: FakeOptions, args: Record<string, unknown>) {
  const failure = options.createTransportFailure?.() ?? null;
  if (failure === 'before') return { data: null, error: TRANSPORT_ERROR };

  const id = args.p_session_id as string;
  const fields = args.p_session as Row;
  options.beforeSessionInsert?.({ ...fields, id });

  const own = db.sessions.find((row) => row.id === id && row.user_id === USER_ID);
  if (own) return { data: { replayed: true, session: own }, error: null };
  if ((db.deleted_sessions ?? []).some((row) => row.session_id === id && row.user_id === USER_ID)) {
    return { data: { replayed: true, deleted: true, session: null }, error: null };
  }
  const profile = (db.profiles ?? []).find((row) => row.id === USER_ID) as Profile | undefined;
  if (
    !resolveUserAccess(profile ?? null).hasProAccess &&
    db.sessions.filter((row) => row.user_id === USER_ID).length >= getFreePlanLimit('sessions')
  ) {
    return { data: null, error: { code: 'TT402', message: 'the free plan holds 10 sessions' } };
  }
  // The vehicle has to be one of this rider's - a deleted one and another rider's alike.
  if (!(db.vehicles ?? []).some((vehicle) => vehicle.id === fields.vehicle_id && vehicle.user_id === USER_ID)) {
    return { data: null, error: { code: 'TT404', message: 'the vehicle this session names is not one of this rider\'s' } };
  }
  if (db.sessions.some((row) => row.id === id)) {
    return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "sessions_pkey"' } };
  }

  const session = {
    created_at: '2026-09-27T12:00:00Z',
    updated_at: '2026-09-27T12:00:00Z',
    ...fields,
    id,
    user_id: USER_ID,
    enabled_modules: fields.enabled_modules ?? {},
  };
  db.sessions.push(session);
  db.session_laps = [
    ...(db.session_laps ?? []),
    ...(args.p_laps as Row[]).map((lap) => ({ ...lap, session_id: id, user_id: USER_ID, source: 'manual' })),
  ];
  if (args.p_environment) {
    db.session_environment = [
      ...(db.session_environment ?? []),
      { id: randomUUID(), ...(args.p_environment as Row), session_id: id, user_id: USER_ID },
    ];
  }

  if (failure === 'after') return { data: null, error: TRANSPORT_ERROR };
  return { data: { replayed: false, session }, error: null };
}

function fakeSupabase(db: Db, options: FakeOptions = {}) {
  const getUser =
    options.getUser ??
    (async (token: string) =>
      token === TOKEN
        ? { data: { user: { id: USER_ID } }, error: null }
        : { data: { user: null }, error: new AuthApiError('invalid JWT', 401, 'bad_jwt') });
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) =>
    name === 'create_session_with_laps'
      ? createSessionWithLaps(db, options, args)
      : { data: null, error: { code: 'PGRST202', message: name } },
  );
  const client = {
    auth: { getUser: vi.fn(getUser) },
    from: (table: string) => new Query(db, table, options),
    rpc,
  };
  createClient.mockReturnValue(client);
  return client;
}

function seed(overrides: Partial<Db> = {}): Db {
  return {
    profiles: [{ id: USER_ID, tier: 'pro', beta_access_started_at: null, beta_access_expires_at: null }],
    vehicles: [{ id: VEHICLE_ID, user_id: USER_ID, type: 'motorcycle' }],
    tracks: [{ id: TRACK_ID, name: 'Road America', is_seeded: true, created_by: null }],
    sessions: [],
    ...overrides,
  };
}

function sessionBody(overrides: Record<string, unknown> = {}) {
  const end = { brand: 'Pirelli', compound: 'SC1', pressure: '31' };
  const shock = { preload: '6', compression: '12', rebound: '10', direction: 'out' };
  return {
    id: SESSION_ID,
    vehicle_id: VEHICLE_ID,
    track_id: TRACK_ID,
    track_name: 'Road America',
    date: '2026-09-27',
    start_time: '09:40',
    conditions: 'sunny',
    tires: { front: { ...end, hot_pressure: '35' }, rear: { ...end, pressure: '28' }, condition: 'scrubbed' },
    suspension: { front: shock, rear: shock },
    alignment: null,
    notes: 'Front pushing in turn 5.',
    laps: [
      { lap_number: 1, lap_time_ms: 142_300, included: true },
      { lap_number: 2, lap_time_ms: 139_800, included: true },
    ],
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` }) {
  return POST(
    new Request('http://localhost/api/mobile/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

/** The website's delete, and the `sessions_record_deleted` trigger it fires. */
function deleteOnWebsite(db: Db, sessionId: string) {
  db.sessions = db.sessions.filter((row) => row.id !== sessionId);
  db.session_laps = (db.session_laps ?? []).filter((row) => row.session_id !== sessionId);
  db.deleted_sessions = [...(db.deleted_sessions ?? []), { user_id: USER_ID, session_id: sessionId }];
}

function freeRiderWith(sessionCount: number): Db {
  return seed({
    profiles: [{ id: USER_ID, tier: 'free', beta_access_started_at: null, beta_access_expires_at: null }],
    sessions: Array.from({ length: sessionCount }, (_, index) => ({
      id: randomUUID(),
      user_id: USER_ID,
      vehicle_id: VEHICLE_ID,
      date: `2026-08-${String(index + 1).padStart(2, '0')}`,
    })),
  });
}

describe('POST /api/mobile/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    vi.stubEnv('MOBILE_APP_ORIGINS', `${WEB_ORIGIN}/, http://localhost:8081`);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses a request with no bearer token as 401, without building a client', async () => {
    const db = seed();
    fakeSupabase(db);
    createClient.mockClear();

    const response = await post(sessionBody(), {});

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'Not authenticated.' });
    expect(createClient).not.toHaveBeenCalled();
    expect(db.sessions).toHaveLength(0);
  });

  it('refuses a token GoTrue rejects as 401', async () => {
    const db = seed();
    fakeSupabase(db);

    const response = await post(sessionBody(), { Authorization: 'Bearer expired-or-forged' });

    expect(response.status).toBe(401);
    expect(db.sessions).toHaveLength(0);
  });

  it('answers 503, not 401, when GoTrue cannot be reached, so the phone does not sign the rider out', async () => {
    const db = seed();
    fakeSupabase(db, {
      getUser: async () => ({ data: { user: null }, error: new AuthRetryableFetchError('fetch failed', 0) }),
    });

    const response = await post(sessionBody());

    expect(response.status).toBe(503);
    expect(reportError).toHaveBeenCalledWith('mobile-sessions', expect.anything(), { check: 'bearer-auth' });
    expect(db.sessions).toHaveLength(0);
  });

  it.each([
    ['rate limits the check', () => new AuthApiError('too many requests', 429, 'over_request_rate_limit')],
    ['answers with a body that is not JSON', () => new AuthUnknownError('Unexpected token <', new SyntaxError())],
    ['fails with a 500 carrying JSON', () => new AuthApiError('internal error', 500, 'unexpected_failure')],
  ])('answers 503, not 401, when GoTrue %s', async (_label, makeError) => {
    const db = seed();
    fakeSupabase(db, { getUser: async () => ({ data: { user: null }, error: makeError() }) });

    const response = await post(sessionBody());

    expect(response.status).toBe(503);
    expect(db.sessions).toHaveLength(0);
  });

  it('refuses a token whose session GoTrue no longer has as 401', async () => {
    const db = seed();
    fakeSupabase(db, { getUser: async () => ({ data: { user: null }, error: new AuthSessionMissingError() }) });

    const response = await post(sessionBody());

    expect(response.status).toBe(401);
    expect(db.sessions).toHaveLength(0);
  });

  it('creates the session under the supplied id, as the rider, and answers 200 with the row', async () => {
    const db = seed();
    const client = fakeSupabase(db);

    const response = await post(sessionBody());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.replayed).toBe(false);
    expect(body.session).toMatchObject({
      id: SESSION_ID,
      user_id: USER_ID,
      track_id: TRACK_ID,
      track_name: 'Road America',
      conditions: 'sunny',
    });
    expect(body.session.tires.front.hot_pressure).toBe('35');
    // Omitted by the phone, so create_session_with_laps coalesces it to `{}`
    // rather than storing a null the constraint refuses.
    expect(body.session.enabled_modules).toEqual({});
    expect(db.sessions).toHaveLength(1);
    expect(db.session_laps).toHaveLength(2);
    // The client is the anon key carrying the rider's own token, never the service role.
    expect(createClient).toHaveBeenCalledWith('http://127.0.0.1:54321', 'anon-key', expect.objectContaining({
      global: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }));
    expect(client.auth.getUser).toHaveBeenCalledWith(TOKEN);
  });

  it('answers a replay of the same id with the same row and writes nothing', async () => {
    const db = seed();
    const client = fakeSupabase(db);

    const first = await (await post(sessionBody())).json();
    const replay = await post(sessionBody());
    const second = await replay.json();

    expect(replay.status).toBe(200);
    expect(second).toEqual({ ok: true, session: first.session, replayed: true });
    expect(db.sessions).toHaveLength(1);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('leaves laps edited on the website alone when a late replay arrives', async () => {
    const db = seed();
    fakeSupabase(db);
    const body = sessionBody({ laps: [], environment: { ambient_temperature_c: 21 } });
    expect((await post(body)).status).toBe(200);
    const edited = [{ session_id: SESSION_ID, user_id: USER_ID, lap_number: 1, lap_time_ms: 101_000, included: true, source: 'manual' }];
    db.session_laps = structuredClone(edited);
    const environmentBefore = structuredClone(db.session_environment);

    const replay = await post(body);

    expect(replay.status).toBe(200);
    expect((await replay.json()).replayed).toBe(true);
    expect(db.session_laps).toEqual(edited);
    expect(db.session_environment).toEqual(environmentBefore);
  });

  it('stores nothing when the create fails in transit, and the retry stores all of it', async () => {
    const db = seed();
    const failures: Array<'before' | null> = ['before'];
    fakeSupabase(db, { createTransportFailure: () => failures.shift() ?? null });
    const body = sessionBody({ environment: { ambient_temperature_c: 21, humidity_percent: 40 } });

    const first = await post(body);

    expect(first.status).toBe(503);
    expect(db.sessions).toHaveLength(0);
    expect(db.session_laps ?? []).toHaveLength(0);
    expect(db.session_environment ?? []).toHaveLength(0);

    const retry = await post(body);

    expect(retry.status).toBe(200);
    expect((await retry.json()).replayed).toBe(false);
    expect(db.sessions).toHaveLength(1);
    expect(db.session_laps.map((lap) => lap.lap_time_ms)).toEqual([142_300, 139_800]);
    expect(db.session_environment).toEqual([
      expect.objectContaining({ session_id: SESSION_ID, ambient_temperature_c: 21, humidity_percent: 40 }),
    ]);
  });

  it('answers the retry of a create whose answer was lost as the complete stored session', async () => {
    const db = seed();
    const failures: Array<'after' | null> = ['after'];
    fakeSupabase(db, { createTransportFailure: () => failures.shift() ?? null });
    const body = sessionBody({ track_id: null, track_name: 'Blackhawk Farms' });

    expect((await post(body)).status).toBe(503);
    const created = db.tracks.find((track) => track.name === 'Blackhawk Farms');
    expect(created).toBeDefined();

    const retry = await post(body);
    const answer = await retry.json();

    expect(retry.status).toBe(200);
    expect(answer.replayed).toBe(true);
    expect(answer.session.track_id).toBe(created?.id);
    expect(db.tracks).toContain(created);
    expect(db.session_laps).toHaveLength(2);
  });

  it('answers the replay of a free rider’s tenth session as the row, not as the cap', async () => {
    const db = freeRiderWith(9);
    fakeSupabase(db);

    expect((await post(sessionBody())).status).toBe(200);
    const replay = await post(sessionBody());

    expect(replay.status).toBe(200);
    expect((await replay.json()).replayed).toBe(true);
    expect(db.sessions).toHaveLength(10);
  });

  it('answers a free rider’s replay as the row, not the cap, when the first call commits while this one resolves', async () => {
    const db = freeRiderWith(9);
    fakeSupabase(db, {
      beforeSessionInsert: (row) => {
        if (!db.sessions.some((existing) => existing.id === row.id)) db.sessions.push({ ...row, notes: 'the first call' });
      },
    });

    const replay = await post(sessionBody());
    const body = await replay.json();

    expect(replay.status).toBe(200);
    expect(body.replayed).toBe(true);
    expect(body.session.notes).toBe('the first call');
    expect(db.sessions).toHaveLength(10);
  });

  it.each<[string, FakeOptions]>([
    ['the atomic create fails in transit', { createTransportFailure: () => 'before' }],
    ['the replay lookup fails', { sessionReadFails: () => true }],
  ])('answers 503 in the phone’s own words when %s, never the website form’s', async (_label, options) => {
    fakeSupabase(seed(), options);

    const response = await post(sessionBody());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Track Tuner could not be reached just now. Your session is still on this phone and will be sent again.',
    });
  });

  it('answers a replay of a session deleted since as handled, and does not create it again', async () => {
    const db = seed();
    const client = fakeSupabase(db);
    const body = sessionBody({ track_id: null, track_name: 'Blackhawk Farms' });
    expect((await post(body)).status).toBe(200);
    const track = db.tracks.find((row) => row.name === 'Blackhawk Farms');
    // The phone's answer was lost, and the rider deleted the session on the website.
    deleteOnWebsite(db, SESSION_ID);

    const retry = await post(body);

    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true, session: null, replayed: true, deleted: true });
    expect(db.sessions).toHaveLength(0);
    expect(db.session_laps).toHaveLength(0);
    expect(client.rpc).toHaveBeenCalledTimes(2);
    // The track the first call created is the rider's; the retry made none of its own.
    expect(db.tracks.filter((row) => row.name === 'Blackhawk Farms')).toEqual([track]);
  });

  it('answers a replay of a session deleted since as handled for a free rider at the cap', async () => {
    const db = freeRiderWith(9);
    fakeSupabase(db);
    expect((await post(sessionBody())).status).toBe(200);
    deleteOnWebsite(db, SESSION_ID);
    db.sessions.push({ id: randomUUID(), user_id: USER_ID, vehicle_id: VEHICLE_ID, date: '2026-09-28' });

    const retry = await post(sessionBody());

    expect(retry.status).toBe(200);
    expect((await retry.json()).deleted).toBe(true);
    expect(db.sessions).toHaveLength(10);
  });

  it('answers a replay of a session deleted with its vehicle as handled, not as a vehicle that is gone', async () => {
    const db = seed();
    fakeSupabase(db);
    expect((await post(sessionBody())).status).toBe(200);
    db.vehicles = [];
    deleteOnWebsite(db, SESSION_ID);

    const retry = await post(sessionBody());

    expect(retry.status).toBe(200);
    expect((await retry.json()).deleted).toBe(true);
    expect(db.sessions).toHaveLength(0);
  });

  it('answers a replay that lands while the first call is still writing with the row that won', async () => {
    const db = seed();
    fakeSupabase(db, {
      beforeSessionInsert: (row) => {
        if (!db.sessions.some((existing) => existing.id === row.id)) db.sessions.push({ ...row, notes: 'the winner' });
      },
    });

    const response = await post(sessionBody());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.replayed).toBe(true);
    expect(body.session.notes).toBe('the winner');
    expect(db.sessions).toHaveLength(1);
  });

  it('keeps the track this attempt created when the replay that won the race points at it', async () => {
    const db = seed();
    fakeSupabase(db, {
      beforeSessionInsert: (row) => {
        if (!db.sessions.some((existing) => existing.id === row.id)) db.sessions.push({ ...row, notes: 'the winner' });
      },
    });

    const response = await post(sessionBody({ track_id: null, track_name: 'Blackhawk Farms' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.replayed).toBe(true);
    const created = db.tracks.find((track) => track.name === 'Blackhawk Farms');
    expect(created).toBeDefined();
    expect(body.session.track_id).toBe(created?.id);
  });

  it('refuses a session whose vehicle was deleted as 400, so the phone parks it rather than retrying', async () => {
    const db = seed({ vehicles: [] });
    fakeSupabase(db);

    const response = await post(sessionBody({ track_id: null, track_name: 'Blackhawk Farms' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: SESSION_REFERENCE_GONE_MESSAGE });
    expect(db.sessions).toHaveLength(0);
    expect(db.tracks.some((track) => track.name === 'Blackhawk Farms')).toBe(false);
    expect(reportError).not.toHaveBeenCalled();
  });

  describe('a vehicle that is not the rider’s', () => {
    const OTHER_RIDER_ID = '99999999-9999-4999-8999-999999999999';
    const FOREIGN_VEHICLE_ID = '55555555-5555-4555-8555-555555555555';

    function seedWithForeignVehicle(): Db {
      return seed({
        vehicles: [
          { id: VEHICLE_ID, user_id: USER_ID, type: 'motorcycle' },
          { id: FOREIGN_VEHICLE_ID, user_id: OTHER_RIDER_ID, type: 'motorcycle' },
        ],
      });
    }

    it('refuses a session on another rider’s vehicle with no laps as 400, storing nothing', async () => {
      const db = seedWithForeignVehicle();
      fakeSupabase(db);

      const response = await post(sessionBody({ vehicle_id: FOREIGN_VEHICLE_ID, laps: [] }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: SESSION_REFERENCE_GONE_MESSAGE });
      expect(db.sessions).toHaveLength(0);
      expect(reportError).not.toHaveBeenCalled();
    });

    it('refuses one with laps as 400, not a 503 the phone would retry forever, storing nothing', async () => {
      const db = seedWithForeignVehicle();
      fakeSupabase(db);

      const response = await post(sessionBody({ vehicle_id: FOREIGN_VEHICLE_ID }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: SESSION_REFERENCE_GONE_MESSAGE });
      expect(db.sessions).toHaveLength(0);
      expect(db.session_laps ?? []).toHaveLength(0);
      expect(db.session_environment ?? []).toHaveLength(0);
    });

    it('still saves a session on the rider’s own vehicle', async () => {
      const db = seedWithForeignVehicle();
      fakeSupabase(db);

      const response = await post(sessionBody());

      expect(response.status).toBe(200);
      expect((await response.json()).session).toMatchObject({ id: SESSION_ID, vehicle_id: VEHICLE_ID });
      expect(db.sessions).toHaveLength(1);
      expect(db.session_laps).toHaveLength(2);
    });
  });

  it.each([
    ['an impossible date', { date: '2026-02-30' }, 'date must be a real calendar day as YYYY-MM-DD.'],
    ['year zero', { date: '0000-01-01' }, 'date must be a real calendar day as YYYY-MM-DD.'],
    ['an impossible start time', { start_time: '25:99' }, 'start_time must be a 24-hour HH:MM or HH:MM:SS, or null.'],
    [
      'a session number past smallint',
      { session_number: 40000 },
      'session_number must be an integer from -32768 to 32767, or null.',
    ],
    [
      'humidity past 100',
      { environment: { humidity_percent: 101 } },
      'environment.humidity_percent must be from 0 to 100, or null.',
    ],
  ])('refuses %s as 400 before anything is written', async (_label, overrides, error) => {
    const db = seed();
    const client = fakeSupabase(db);

    const response = await post(sessionBody(overrides));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error });
    expect(db.sessions).toHaveLength(0);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('accepts a leap day, midnight and the edges of the humidity range', async () => {
    const db = seed();
    fakeSupabase(db);

    const response = await post(
      sessionBody({ date: '2028-02-29', start_time: '23:59:59', session_number: 32767, environment: { humidity_percent: 100 } }),
    );

    expect(response.status).toBe(200);
    expect(db.session_environment).toHaveLength(1);
  });

  it('answers 409 when the id is already taken by a row this rider cannot see', async () => {
    const db = seed();
    // RLS hides another rider's row from every read, so the only sign of it is
    // the insert's unique violation: the insert collides, the read-back is empty.
    fakeSupabase(db, {
      beforeSessionInsert: (row) => {
        db.sessions.push({ ...row, user_id: '99999999-9999-4999-8999-999999999999' });
      },
    });

    const response = await post(sessionBody());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/already in use/);
  });

  it('refuses a free rider’s eleventh session as 402 with the plan message, writing nothing', async () => {
    const db = freeRiderWith(10);
    const client = fakeSupabase(db);

    const response = await post(sessionBody({ track_id: null, track_name: 'Blackhawk Farms' }));

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ ok: false, error: getFreePlanLimitMessage('sessions') });
    expect(db.sessions).toHaveLength(10);
    // Counted inside create_session_with_laps, so the track resolved for it goes again.
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(db.tracks.some((track) => track.name === 'Blackhawk Farms')).toBe(false);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('saves one and refuses the other when a free rider at nine sends two different sessions at once', async () => {
    const db = freeRiderWith(9);
    fakeSupabase(db);

    const responses = await Promise.all([post(sessionBody()), post(sessionBody({ id: randomUUID() }))]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 402]);
    expect(db.sessions).toHaveLength(10);
  });

  it('saves a beta rider’s eleventh session, since the function reads the same entitlement', async () => {
    const db = freeRiderWith(10);
    db.profiles = [
      { id: USER_ID, tier: 'free', beta_access_started_at: null, beta_access_expires_at: '2999-01-01T00:00:00Z' },
    ];
    fakeSupabase(db);

    const response = await post(sessionBody());

    expect(response.status).toBe(200);
    expect(db.sessions).toHaveLength(11);
  });

  it('refuses a session with no weather answer as 400 with MISSING_CONDITIONS_MESSAGE', async () => {
    const db = seed();
    fakeSupabase(db);
    const body: Record<string, unknown> = sessionBody();
    delete body.conditions;

    const response = await post(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: MISSING_CONDITIONS_MESSAGE });
    expect(db.sessions).toHaveLength(0);
  });

  it('refuses a numeric setup leaf rather than storing a value the session screens cannot print', async () => {
    const db = seed();
    fakeSupabase(db);
    const body = sessionBody();
    (body.tires.front as Record<string, unknown>).pressure = 30;

    const response = await post(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'tires.front.pressure must be a string.' });
    expect(db.sessions).toHaveLength(0);
  });

  it('refuses a body without a UUID id, since the id is what makes a replay safe', async () => {
    const db = seed();
    fakeSupabase(db);

    const response = await post(sessionBody({ id: undefined }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'id must be a UUID.' });
  });

  it('answers 503 when the plan cannot be read, rather than treating a Pro rider as free', async () => {
    const db = seed();
    fakeSupabase(db, { profileReadFails: true });

    const response = await post(sessionBody());

    expect(response.status).toBe(503);
    expect(db.sessions).toHaveLength(0);
    expect(reportError).toHaveBeenCalledWith('mobile-sessions', expect.any(Error), {
      check: 'profile-read',
      table: 'profiles',
    });
  });

  it('refuses a chunked body past 64 KiB as 413 without reading the rest, storing nothing', async () => {
    const db = seed();
    const client = fakeSupabase(db);
    const chunk = new TextEncoder().encode(`{"notes":"${'x'.repeat(16 * 1024)}`);
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        // Endless: a reader that waits for the end never returns.
        controller.enqueue(chunk);
      },
    });
    const request = new Request('http://localhost/api/mobile/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit);
    expect(request.headers.get('content-length')).toBeNull();

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, error: 'Request body is too large.' });
    expect(pulled).toBeLessThan(10);
    expect(db.sessions).toHaveLength(0);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON as 400', async () => {
    fakeSupabase(seed());

    const response = await post('{not json');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'Request body must be valid JSON.' });
  });

  it('answers the web build’s CORS preflight for an allowed origin', async () => {
    const response = OPTIONS(
      new Request('http://localhost/api/mobile/sessions', {
        method: 'OPTIONS',
        headers: {
          Origin: WEB_ORIGIN,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type',
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toBe('authorization, content-type');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it('refuses the preflight for an origin not on the allowlist', async () => {
    const response = OPTIONS(
      new Request('http://localhost/api/mobile/sessions', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('allows the web origin on the POST itself, and no origin for any other', async () => {
    fakeSupabase(seed());
    const allowed = await post(sessionBody(), { Authorization: `Bearer ${TOKEN}`, Origin: WEB_ORIGIN });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);

    fakeSupabase(seed());
    const other = await post(sessionBody(), { Authorization: `Bearer ${TOKEN}`, Origin: 'https://evil.example' });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});
