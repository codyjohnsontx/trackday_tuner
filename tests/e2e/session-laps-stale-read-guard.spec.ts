import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { EMPTY_SUSPENSION, EMPTY_TIRES } from '@/tests/e2e/helpers/session-fixtures';
import type { Database } from '@/types/supabase';

/**
 * `replace_session_laps` deletes every lap on the session before inserting, so a
 * caller that mistakes "I read nothing" for "there is nothing" destroys the
 * rider's times. `getSessionLaps` was that caller - it discarded its Supabase
 * error, the session page offered "Add Lap Times" on a session holding four, and
 * whatever the rider retyped replaced them. That caller is fixed, and this
 * covers the half of the fix that outlives it: the function now asks how many
 * laps the caller believes are stored and refuses when that number differs,
 * which is what protects a caller nobody has written yet.
 *
 * The tests below are all count MISMATCHES, because a count is all the guard
 * compares. An equal-count stale save - two tabs that both read 12 laps, one
 * editing times or `included` flags and saving before the other - passes it, and
 * is written up in 20260901001400. Nothing here should be read as covering that.
 *
 * It runs the RPC as a rider rather than through the app, because the guard is a
 * property of the function and the point is that it holds for callers that are
 * not `replaceSessionLaps`. The last test is the one thing only the browser can
 * settle: that clearing every lap in the editor asks first.
 */

const LAPS = [
  { lap_number: 1, lap_time_ms: 102_350, included: true },
  { lap_number: 2, lap_time_ms: 101_920, included: true },
  { lap_number: 3, lap_time_ms: 101_700, included: true },
  { lap_number: 4, lap_time_ms: 101_480, included: true },
];

/** What a rider who was shown an empty editor types back in from memory. */
const RETYPED = [{ lap_number: 1, lap_time_ms: 103_000, included: true }];

function createRiderClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.');
  }
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signInAs(page: Page, email: string, password: string) {
  await page.goto('/login');

  const form = page.locator('form');
  const emailField = form.getByLabel('Email');
  const passwordField = form.getByLabel('Password');

  // Controlled inputs: anything typed before React hydrates is discarded.
  await expect(async () => {
    await emailField.fill(email);
    await passwordField.fill(password);
    await expect(emailField).toHaveValue(email);
    await expect(passwordField).toHaveValue(password);
  }).toPass({ timeout: 10_000 });

  await form.getByRole('button', { name: /^Sign In$/ }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test.describe('replace_session_laps against a caller that never read the laps', () => {
  test.describe.configure({ timeout: 120_000 });

  test.skip(
    !hasServiceRole(),
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to plant a rider with laps',
  );
  // Separate from hasServiceRole(): the service role only plants the rider, while
  // every call under test goes out through createRiderClient().
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'NEXT_PUBLIC_SUPABASE_ANON_KEY is required to call replace_session_laps as the rider - it is security invoker and checks auth.uid().',
  );

  // Its own throwaway rider: the RPC is `security invoker` and checks
  // `auth.uid()`, so the call has to carry a real session, and the laps this
  // plants must not land in the shared E2E account other specs read.
  let riderId: string | null = null;
  let email = '';
  let password = '';
  let sessionId = '';
  let rider: SupabaseClient<Database>;

  async function storedLapTimes(): Promise<number[]> {
    const { data } = await createTestAdminClient()
      .from('session_laps')
      .select('lap_time_ms')
      .eq('session_id', sessionId)
      .order('lap_number');
    return (data ?? []).map((lap) => lap.lap_time_ms);
  }

  test.beforeEach(async ({}, testInfo: TestInfo) => {
    const admin = createTestAdminClient();
    email = `lap-guard-${testInfo.project.name}-${randomUUID()}@example.com`;
    password = `pw-${randomUUID()}`;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(createError, createError?.message).toBeNull();
    riderId = created.user!.id;

    const { data: vehicle, error: vehicleError } = await admin
      .from('vehicles')
      .insert({ user_id: riderId, nickname: 'Lap guard bike', type: 'motorcycle' })
      .select('id')
      .single();
    expect(vehicleError, vehicleError?.message).toBeNull();

    const { data: session, error: sessionError } = await admin
      .from('sessions')
      .insert({
        user_id: riderId,
        vehicle_id: vehicle!.id,
        track_name: `Lap guard circuit ${randomUUID()}`,
        date: '2019-06-13',
        conditions: 'sunny' as const,
        tires: EMPTY_TIRES,
        suspension: EMPTY_SUSPENSION,
      })
      .select('id')
      .single();
    expect(sessionError, sessionError?.message).toBeNull();
    sessionId = session!.id;

    rider = createRiderClient();
    const { error: signInError } = await rider.auth.signInWithPassword({ email, password });
    expect(signInError, signInError?.message).toBeNull();

    // The session holds no laps yet, so this is the honest count - and it is the
    // same call `createSession` makes.
    const { error: seedError } = await rider.rpc('replace_session_laps', {
      p_user_id: riderId,
      p_session_id: sessionId,
      p_laps: LAPS,
      p_expected_lap_count: 0,
    });
    expect(seedError, seedError?.message).toBeNull();
    expect(await storedLapTimes()).toEqual(LAPS.map((lap) => lap.lap_time_ms));
  });

  test.afterEach(async () => {
    if (!riderId) return;
    // Vehicles, sessions and their laps cascade from auth.users.
    await createTestAdminClient().auth.admin.deleteUser(riderId);
    riderId = null;
  });

  test('refuses the replacement a failed read would have sent, and keeps the laps', async () => {
    // Exactly the bug: the caller read nothing, so it says nothing is there, and
    // asks for the session to hold the one lap the rider retyped.
    const { error } = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: RETYPED,
      p_expected_lap_count: 0,
    });

    expect(error?.code).toBe('TT409');
    expect(await storedLapTimes()).toEqual(LAPS.map((lap) => lap.lap_time_ms));
  });

  test('refuses an empty replacement from a caller that read nothing', async () => {
    const { error } = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: [],
      p_expected_lap_count: 0,
    });

    expect(error?.code).toBe('TT409');
    expect(await storedLapTimes()).toEqual(LAPS.map((lap) => lap.lap_time_ms));
  });

  test('refuses a caller that names the argument and states nothing', async () => {
    const { error } = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: [],
      p_expected_lap_count: null as unknown as number,
    });

    expect(error?.code).toBe('TT409');
    expect(await storedLapTimes()).toEqual(LAPS.map((lap) => lap.lap_time_ms));
  });

  test('leaves no unguarded three-argument function behind', async () => {
    // `create or replace` with an added parameter would have made an overload
    // rather than a replacement, and the old signature would still delete
    // without asking anything. The migration drops it, so this call finds
    // nothing rather than the function it used to reach.
    const { error } = await rider.rpc(
      'replace_session_laps',
      { p_user_id: riderId!, p_session_id: sessionId, p_laps: [] } as never,
    );

    expect(error?.code).toBe('PGRST202');
    expect(await storedLapTimes()).toEqual(LAPS.map((lap) => lap.lap_time_ms));
  });

  test('replaces the laps for a caller that did read them', async () => {
    const replacement = [{ lap_number: 1, lap_time_ms: 99_500, included: true }];

    const { error } = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: replacement,
      p_expected_lap_count: LAPS.length,
    });

    expect(error, error?.message).toBeNull();
    expect(await storedLapTimes()).toEqual([99_500]);
  });

  test('asks before a save that clears every lap on the session', async ({ page }) => {
    await signInAs(page, email, password);
    await page.goto(`/sessions/${sessionId}`);

    await page.getByRole('button', { name: 'Edit' }).click();
    for (const lap of LAPS) {
      await page.getByRole('button', { name: `Remove lap ${lap.lap_number}` }).click();
    }

    let asked: string | null = null;
    page.once('dialog', async (dialog) => {
      asked = dialog.message();
      await dialog.dismiss();
    });
    await page.getByRole('button', { name: 'Save laps' }).click();

    // Declining is the whole point: the laps are still there afterwards.
    await expect(() => expect(asked).not.toBeNull()).toPass({ timeout: 10_000 });
    expect(asked).toContain('4');
    expect(await storedLapTimes()).toEqual(LAPS.map((lap) => lap.lap_time_ms));

    // And accepting still clears them, so the confirmation is a question rather
    // than a refusal.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Save laps' }).click();
    await expect(page.getByText('Lap data saved.')).toBeVisible({ timeout: 20_000 });
    expect(await storedLapTimes()).toEqual([]);
  });
});
