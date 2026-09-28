import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import {
  createThrowawayRider,
  deleteThrowawayRider,
  type ThrowawayRider,
} from '@/tests/e2e/helpers/throwaway-rider';
import type { Database, Json } from '@/types/supabase';

/**
 * `create_session_with_laps` (20260927002200) against a real database.
 *
 * The route suite (app/api/mobile/sessions/route.test.ts) replaces this function
 * with an in-memory fake so it can pin statuses and copy quickly. A fake is
 * atomic and callable by construction, so it cannot notice the real function
 * losing either property. This spec calls the real function as two signed-in
 * riders and as nobody, and reads what was stored back through the service
 * role. It checks five things:
 *
 * - a failure after the session row (here the environment's CHECK) leaves no
 *   session, no laps and no lap summary;
 * - a vehicle that is not the caller's is refused as TT404 with nothing stored;
 * - two concurrent calls on one id store one complete session;
 * - a late replay leaves laps edited since then alone;
 * - anon cannot execute it.
 *
 * Needs no browser and no dev server: the NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY of a stack built
 * with 20260927002200 applied. A stack without it fails rather than skips.
 */

type Client = SupabaseClient<Database>;

const LAPS = [
  { lap_number: 1, lap_time_ms: 142_300, included: true },
  { lap_number: 2, lap_time_ms: 139_800, included: true },
  { lap_number: 3, lap_time_ms: 140_100, included: false },
];

const ENVIRONMENT = { ambient_temperature_c: 21, humidity_percent: 40, weather_condition: 'dry' };

function url(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL!;
}

function anonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
}

function anonClient(): Client {
  return createClient<Database>(url(), anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(rider: ThrowawayRider): Promise<Client> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email: rider.email, password: rider.password });
  expect(error, error?.message).toBeNull();
  return client;
}

async function createVehicle(client: Client, userId: string): Promise<string> {
  const { data, error } = await client
    .from('vehicles')
    .insert({ user_id: userId, nickname: 'Test bike', make: 'Yamaha', model: 'R6', year: 2020, type: 'motorcycle' })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  return data!.id;
}

function sessionFields(vehicleId: string): Json {
  const end = { brand: 'Pirelli', compound: 'SC1', pressure: '31' };
  const shock = { preload: '6', compression: '12', rebound: '10', direction: 'out' };
  return {
    vehicle_id: vehicleId,
    track_name: 'Road America',
    date: '2026-09-27',
    start_time: '09:40',
    conditions: 'sunny',
    tires: { front: end, rear: end, condition: 'scrubbed' },
    suspension: { front: shock, rear: shock },
    notes: 'Front pushing in turn 5.',
  };
}

function create(client: Client, sessionId: string, vehicleId: string, laps: Json = LAPS, environment: Json | null = ENVIRONMENT) {
  return client.rpc('create_session_with_laps', {
    p_session_id: sessionId,
    p_session: sessionFields(vehicleId),
    p_laps: laps,
    p_environment: environment,
  });
}

/** Everything stored for a session id, read past RLS. A failed read fails the test rather than reading as empty. */
async function stored(admin: Client, sessionId: string) {
  const [sessions, laps, environment, summaries] = await Promise.all([
    admin.from('sessions').select('id, user_id, vehicle_id').eq('id', sessionId),
    admin.from('session_laps').select('lap_number, lap_time_ms, included').eq('session_id', sessionId).order('lap_number'),
    admin.from('session_environment').select('humidity_percent').eq('session_id', sessionId),
    admin.from('telemetry_summaries').select('id').eq('session_id', sessionId),
  ]);
  for (const read of [sessions, laps, environment, summaries]) expect(read.error, read.error?.message).toBeNull();
  return {
    sessions: sessions.data!,
    laps: laps.data!,
    environment: environment.data!,
    summaries: summaries.data!,
  };
}

test.describe('create_session_with_laps as riders and as nobody', () => {
  test.skip(!hasServiceRole(), 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'NEXT_PUBLIC_SUPABASE_ANON_KEY is required: the function is security invoker and has to be called as a rider.',
  );

  let admin: Client;
  let alice: ThrowawayRider | null = null;
  let bob: ThrowawayRider | null = null;
  let aliceClient: Client;
  let bobClient: Client;
  let aliceVehicle: string;

  test.beforeAll(async () => {
    admin = createTestAdminClient();
    alice = await createThrowawayRider('create-session-alice');
    bob = await createThrowawayRider('create-session-bob');
    aliceClient = await signIn(alice);
    bobClient = await signIn(bob);
    aliceVehicle = await createVehicle(aliceClient, alice.id);
  });

  test.afterAll(async () => {
    await deleteThrowawayRider(alice);
    await deleteThrowawayRider(bob);
  });

  test('stores the session, its laps, lap summary and environment together', async () => {
    const sessionId = randomUUID();

    const { data, error } = await create(aliceClient, sessionId, aliceVehicle);

    expect(error, error?.message).toBeNull();
    expect(data).toMatchObject({ replayed: false, session: { id: sessionId, user_id: alice!.id } });
    const rows = await stored(admin, sessionId);
    expect(rows.sessions).toHaveLength(1);
    expect(rows.laps).toEqual(LAPS);
    expect(rows.summaries).toHaveLength(1);
    expect(rows.environment).toEqual([{ humidity_percent: 40 }]);
  });

  test('leaves no session, laps or summary when the environment write fails after them', async () => {
    const sessionId = randomUUID();

    // humidity 150 breaks session_environment's CHECK, the last write the function makes.
    const { error } = await create(aliceClient, sessionId, aliceVehicle, LAPS, { ...ENVIRONMENT, humidity_percent: 150 });

    expect(error?.code).toBe('23514');
    expect(await stored(admin, sessionId)).toEqual({ sessions: [], laps: [], environment: [], summaries: [] });

    // The retry the phone makes then stores all of it.
    const retry = await create(aliceClient, sessionId, aliceVehicle);
    expect(retry.error, retry.error?.message).toBeNull();
    const rows = await stored(admin, sessionId);
    expect(rows.sessions).toHaveLength(1);
    expect(rows.laps).toEqual(LAPS);
    expect(rows.environment).toHaveLength(1);
  });

  test('refuses another rider’s vehicle as TT404, storing nothing', async () => {
    const sessionId = randomUUID();

    const { error } = await create(bobClient, sessionId, aliceVehicle);

    expect(error?.code).toBe('TT404');
    expect(await stored(admin, sessionId)).toEqual({ sessions: [], laps: [], environment: [], summaries: [] });
  });

  test('refuses another rider’s session id without touching their session', async () => {
    const sessionId = randomUUID();
    expect((await create(aliceClient, sessionId, aliceVehicle)).error).toBeNull();
    const bobVehicle = await createVehicle(bobClient, bob!.id);

    const { error } = await create(bobClient, sessionId, bobVehicle, []);

    expect(error?.code).toBe('23505');
    const rows = await stored(admin, sessionId);
    expect(rows.sessions).toEqual([{ id: sessionId, user_id: alice!.id, vehicle_id: aliceVehicle }]);
    expect(rows.laps).toEqual(LAPS);
  });

  test('stores one complete session when two calls on one id race', async () => {
    const sessionId = randomUUID();

    const results = await Promise.all([create(aliceClient, sessionId, aliceVehicle), create(aliceClient, sessionId, aliceVehicle)]);

    for (const result of results) expect(result.error, result.error?.message).toBeNull();
    const replayed = results.map((result) => (result.data as { replayed: boolean }).replayed).sort();
    expect(replayed).toEqual([false, true]);
    const rows = await stored(admin, sessionId);
    expect(rows.sessions).toHaveLength(1);
    expect(rows.laps).toEqual(LAPS);
    expect(rows.summaries).toHaveLength(1);
    expect(rows.environment).toHaveLength(1);
  });

  test('answers a late replay as the stored session and leaves laps edited since alone', async () => {
    const sessionId = randomUUID();
    expect((await create(aliceClient, sessionId, aliceVehicle)).error).toBeNull();
    // The rider re-times a lap on the website after the phone's answer was lost.
    const edited = [{ lap_number: 1, lap_time_ms: 138_000, included: true }];
    const edit = await aliceClient.rpc('replace_session_laps', {
      p_user_id: alice!.id,
      p_session_id: sessionId,
      p_laps: edited,
      p_expected_laps: LAPS,
    });
    expect(edit.error, edit.error?.message).toBeNull();

    const replay = await create(aliceClient, sessionId, aliceVehicle);

    expect(replay.error, replay.error?.message).toBeNull();
    expect(replay.data).toMatchObject({ replayed: true, session: { id: sessionId } });
    expect((await stored(admin, sessionId)).laps).toEqual(edited);
  });

  test('cannot be executed as nobody', async () => {
    const sessionId = randomUUID();

    const { error } = await create(anonClient(), sessionId, aliceVehicle);

    // Refused by the missing execute grant, not only by the body's own
    // auth.uid() check, which raises the same 42501 with its own message.
    expect(error?.code).toBe('42501');
    expect(error?.message).toMatch(/permission denied for function create_session_with_laps/);
    expect(await stored(admin, sessionId)).toEqual({ sessions: [], laps: [], environment: [], summaries: [] });
  });
});
