import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { EMPTY_SUSPENSION, EMPTY_TIRES } from '@/tests/e2e/helpers/session-fixtures';
import type { Database } from '@/types/supabase';

/**
 * `replace_session_laps` deletes every lap on the session before inserting, so a
 * caller that replaces a set it never saw destroys the rider's times. It asks
 * the caller for the laps it believes are stored and refuses unless they ARE the
 * stored ones - lap numbers, lap times and `included` flags alike (20260903001500).
 *
 * Two failures live under that, and both are covered here. The first is the one
 * that shipped: `getSessionLaps` discarded its Supabase error, so a failed read
 * came back as `[]`, the session page offered "Add Lap Times" on a session
 * holding four, and whatever the rider retyped replaced them. The second is the
 * one a COUNT could never catch, and it is the headline below - two tabs both
 * load a session holding twelve laps, the first re-times a lap and excludes
 * another without changing how many there are, and the second saves its stale
 * snapshot. Twelve equals twelve, so the count guard that preceded this passed
 * it and the first tab's work went silently. It is refused now.
 *
 * The other thing these pin is the fail-safe direction: the guard has to refuse
 * a stale save WITHOUT refusing a real one. So a legitimate sequential save, a
 * claim listing the same laps in another order, and a save whose
 * `telemetry_summaries` row was just rewritten - by this very function, and by
 * the rider directly - all still succeed. A guard that refuses honest saves
 * would be worse for a rider than the gap it closes.
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

/**
 * What the first of two tabs saves: lap 2 re-timed and lap 4 dropped from the
 * average. Four laps before, four laps after - which is the whole point.
 */
const FIRST_TAB_EDIT = LAPS.map((lap) =>
  lap.lap_number === 2 ? { ...lap, lap_time_ms: 99_880 }
  : lap.lap_number === 4 ? { ...lap, included: false }
  : lap);

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

  /** The stored set in the shape a caller states its belief in. */
  async function storedLaps(): Promise<{ lap_number: number; lap_time_ms: number; included: boolean }[]> {
    const { data } = await createTestAdminClient()
      .from('session_laps')
      .select('lap_number, lap_time_ms, included')
      .eq('session_id', sessionId)
      .order('lap_number');
    return data ?? [];
  }

  async function storedSummary(): Promise<{ summary: string | null; updated_at: string } | null> {
    const { data } = await createTestAdminClient()
      .from('telemetry_summaries')
      .select('summary, updated_at')
      .eq('session_id', sessionId)
      .maybeSingle();
    return data;
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

    // The session holds no laps yet, so an empty claim is the honest one - and
    // it is the same call `createSession` makes.
    const { error: seedError } = await rider.rpc('replace_session_laps', {
      p_user_id: riderId,
      p_session_id: sessionId,
      p_laps: LAPS,
      p_expected_laps: [],
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
      p_expected_laps: [],
    });

    expect(error?.code).toBe('TT409');
    expect(await storedLapTimes()).toEqual(LAPS.map((lap) => lap.lap_time_ms));
  });

  test('refuses an empty replacement from a caller that read nothing', async () => {
    const { error } = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: [],
      p_expected_laps: [],
    });

    expect(error?.code).toBe('TT409');
    expect(await storedLapTimes()).toEqual(LAPS.map((lap) => lap.lap_time_ms));
  });

  test('refuses a caller that names the argument and states nothing', async () => {
    const { error } = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: [],
      p_expected_laps: null as unknown as [],
    });

    expect(error?.code).toBe('TT409');
    expect(await storedLapTimes()).toEqual(LAPS.map((lap) => lap.lap_time_ms));
  });

  test('refuses a claim that is not a set of laps, rather than failing on it', async () => {
    // Nothing in the claim is cast on the way to the comparison, so a caller
    // sending nonsense meets the guard rather than a cast error - and a guard
    // that cannot be made to throw is one that cannot be talked past.
    const { error } = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: [],
      p_expected_laps: [7, 'not a lap', {}] as unknown as [],
    });

    expect(error?.code).toBe('TT409');
    expect(await storedLapTimes()).toEqual(LAPS.map((lap) => lap.lap_time_ms));
  });

  test('leaves no weaker signature behind to call instead', async () => {
    // `create or replace` with an added or retyped parameter makes an overload
    // rather than a replacement, and either older signature would still delete
    // on a belief this one refuses - the three-argument form asks nothing at
    // all, and the count form passes the equal-count save below. Both are
    // dropped, so these calls find nothing rather than the function they used
    // to reach.
    const unguarded = await rider.rpc(
      'replace_session_laps',
      { p_user_id: riderId!, p_session_id: sessionId, p_laps: [] } as never,
    );
    expect(unguarded.error?.code).toBe('PGRST202');

    const byCount = await rider.rpc(
      'replace_session_laps',
      { p_user_id: riderId!, p_session_id: sessionId, p_laps: [], p_expected_lap_count: LAPS.length } as never,
    );
    expect(byCount.error?.code).toBe('PGRST202');

    expect(await storedLapTimes()).toEqual(LAPS.map((lap) => lap.lap_time_ms));
  });

  test('replaces the laps for a caller that did read them', async () => {
    const replacement = [{ lap_number: 1, lap_time_ms: 99_500, included: true }];

    const { error } = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: replacement,
      p_expected_laps: LAPS,
    });

    expect(error, error?.message).toBeNull();
    expect(await storedLapTimes()).toEqual([99_500]);
  });

  test('takes the laps it read in any order, because a set has no order', async () => {
    // The caller echoes what it read, and nothing promises the order it read it
    // in. Refusing over the order would be a false refusal on an honest save.
    const { error } = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: FIRST_TAB_EDIT,
      p_expected_laps: [...LAPS].reverse(),
    });

    expect(error, error?.message).toBeNull();
    expect(await storedLaps()).toEqual(FIRST_TAB_EDIT);
  });

  /**
   * The case a count cannot see, and the reason this guard compares content.
   *
   * Both tabs read the same four laps. The first re-times lap 2 and drops lap 4
   * from the average, so four laps go in and four laps come out. The second tab
   * still believes the four it read. Against the count guard that preceded this
   * (20260901001400) that second save was accepted - 4 equalled 4 - and the
   * first tab's work vanished with no error anywhere.
   */
  test('refuses a stale save that holds the same NUMBER of laps as the stored set', async () => {
    const first = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: FIRST_TAB_EDIT,
      p_expected_laps: LAPS,
    });
    expect(first.error, first.error?.message).toBeNull();
    expect(await storedLaps()).toEqual(FIRST_TAB_EDIT);

    // The second tab's own edit, built on the snapshot it loaded before any of
    // that happened. Same lap count as what is stored; different laps.
    const secondTabEdit = LAPS.map((lap) =>
      lap.lap_number === 1 ? { ...lap, lap_time_ms: 100_010 } : lap);
    const second = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: secondTabEdit,
      p_expected_laps: LAPS,
    });

    expect(second.error?.code).toBe('TT409');
    expect(await storedLaps()).toEqual(FIRST_TAB_EDIT);
  });

  test('refuses a stale save whose only difference is an included flag', async () => {
    // The weakest difference the guard has to see: same laps, same times, same
    // count, one flag moved. A digest over lap times alone would miss it.
    const excluded = LAPS.map((lap) =>
      lap.lap_number === 3 ? { ...lap, included: false } : lap);
    const first = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: excluded,
      p_expected_laps: LAPS,
    });
    expect(first.error, first.error?.message).toBeNull();

    const second = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: RETYPED,
      p_expected_laps: LAPS,
    });

    expect(second.error?.code).toBe('TT409');
    expect(await storedLaps()).toEqual(excluded);
  });

  /**
   * The identity is read off `session_laps` and nothing else, so the
   * `telemetry_summaries` upsert this same function runs on every successful
   * save cannot make the next save look stale. Hanging the identity off that
   * row's `updated_at` is the shortcut this design most invites, and it would
   * fail here: the row is rewritten by the save itself, and - the second half of
   * this test - `authenticated` can rewrite it directly.
   */
  test('does not refuse a save because telemetry_summaries was rewritten', async () => {
    const seeded = await storedSummary();
    expect(seeded, 'the seed save should have written a manual summary').not.toBeNull();

    const first = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: FIRST_TAB_EDIT,
      p_expected_laps: LAPS,
    });
    expect(first.error, first.error?.message).toBeNull();

    const rewritten = await storedSummary();
    expect(rewritten!.updated_at).not.toBe(seeded!.updated_at);

    // Straight after that rewrite, with an honest claim.
    const second = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: LAPS,
      p_expected_laps: FIRST_TAB_EDIT,
    });
    expect(second.error, second.error?.message).toBeNull();
    expect(await storedLaps()).toEqual(LAPS);

    // And with the summary row rewritten by the rider rather than by the
    // function, which is a write the identity must also stay blind to.
    const { error: summaryError } = await rider
      .from('telemetry_summaries')
      .update({ summary: 'rewritten by the rider' })
      .eq('session_id', sessionId);
    expect(summaryError, summaryError?.message).toBeNull();

    const third = await rider.rpc('replace_session_laps', {
      p_user_id: riderId!,
      p_session_id: sessionId,
      p_laps: FIRST_TAB_EDIT,
      p_expected_laps: LAPS,
    });
    expect(third.error, third.error?.message).toBeNull();
    expect(await storedLaps()).toEqual(FIRST_TAB_EDIT);
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
