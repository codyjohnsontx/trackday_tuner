import { randomUUID } from 'node:crypto';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFreePlanLimitMessage } from '@/lib/plans';
import { MISSING_CONDITIONS_MESSAGE } from '@/lib/session-answers';

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
  /** Runs just before a `sessions` insert lands - used to stage a race. */
  beforeSessionInsert?: (row: Row) => void;
  /** Make every `profiles` read fail. */
  profileReadFails?: boolean;
}

class Query {
  private op: 'select' | 'insert' | 'delete' = 'select';
  private filters: Array<[string, unknown]> = [];
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
  // Filters the create path uses that this fake does not model. `or` is the
  // seeded-or-own visibility rule, which every row here already satisfies.
  or() { return this; }
  order() { return this; }
  lt() { return this; }
  limit() { return this; }

  private matching(): Row[] {
    return (this.db[this.table] ??= []).filter((row) => this.filters.every(([c, v]) => row[c] === v));
  }

  private run(): { data: unknown; error: unknown; count?: number } {
    if (this.table === 'profiles' && this.options.profileReadFails) {
      return { data: null, error: { code: '', message: 'fetch failed' } };
    }
    const table = (this.db[this.table] ??= []);
    if (this.op === 'insert') {
      const written: Row[] = [];
      for (const input of this.rows) {
        if (this.table === 'sessions') this.options.beforeSessionInsert?.(input);
        // `sessions.enabled_modules` is NOT NULL DEFAULT '{}' (20260228000200):
        // an omitted key takes the default and an explicit null is refused.
        if (this.table === 'sessions' && input.enabled_modules === null) {
          return {
            data: null,
            error: { code: '23502', message: 'null value in column "enabled_modules" of relation "sessions" violates not-null constraint' },
          };
        }
        const defaults = this.table === 'sessions' ? { enabled_modules: {} } : {};
        const row = { id: randomUUID(), created_at: '2026-09-27T12:00:00Z', updated_at: '2026-09-27T12:00:00Z', ...defaults, ...input };
        if (table.some((existing) => existing.id === row.id)) {
          return {
            data: null,
            error: { code: '23505', message: `duplicate key value violates unique constraint "${this.table}_pkey"` },
          };
        }
        table.push(row);
        written.push(row);
      }
      return { data: this.returning ? written : null, error: null };
    }
    if (this.op === 'delete') {
      const gone = this.matching();
      this.db[this.table] = table.filter((row) => !gone.includes(row));
      return { data: gone, error: null };
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

function fakeSupabase(db: Db, options: FakeOptions = {}) {
  const getUser =
    options.getUser ??
    (async (token: string) =>
      token === TOKEN
        ? { data: { user: { id: USER_ID } }, error: null }
        : { data: { user: null }, error: new AuthApiError('invalid JWT', 401, 'bad_jwt') });
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name !== 'replace_session_laps') return { data: null, error: { code: 'PGRST202', message: name } };
    const laps = args.p_laps as Row[];
    db.session_laps = [
      ...(db.session_laps ?? []).filter((lap) => lap.session_id !== args.p_session_id),
      ...laps.map((lap) => ({ ...lap, session_id: args.p_session_id, user_id: args.p_user_id })),
    ];
    return { data: null, error: null };
  });
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
    // Omitted by the phone, so the column default rather than a null the
    // constraint refuses.
    expect(body.session.enabled_modules).toEqual({});
    expect(db.sessions).toHaveLength(1);
    expect(db.session_laps).toHaveLength(2);
    // The client is the anon key carrying the rider's own token, never the service role.
    expect(createClient).toHaveBeenCalledWith('http://127.0.0.1:54321', 'anon-key', expect.objectContaining({
      global: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }));
    expect(client.auth.getUser).toHaveBeenCalledWith(TOKEN);
  });

  it('answers a replay of the same id with the same row and writes nothing more', async () => {
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

  it('answers the replay of a free rider’s tenth session as the row, not as the cap', async () => {
    const db = freeRiderWith(9);
    fakeSupabase(db);

    expect((await post(sessionBody())).status).toBe(200);
    const replay = await post(sessionBody());

    expect(replay.status).toBe(200);
    expect((await replay.json()).replayed).toBe(true);
    expect(db.sessions).toHaveLength(10);
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

    const response = await post(sessionBody());

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ ok: false, error: getFreePlanLimitMessage('sessions') });
    expect(db.sessions).toHaveLength(10);
    expect(client.rpc).not.toHaveBeenCalled();
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
