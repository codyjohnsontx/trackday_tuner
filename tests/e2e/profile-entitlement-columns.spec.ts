import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import type { Database } from '@/types/supabase';

// The Data API half of what tests/unit/migrations-bootstrap.test.ts guards as
// text.
//
// That guard fails any migration granting anon, authenticated or public more
// than SELECT on profiles, and says outright that it cannot see a grant made by
// hand in the dashboard or the privileges of a project whose schema was never
// applied through the CLI. This is the request the escalation was reported
// through, sent at a real PostgREST: an ordinary rider, holding the public key
// and their own session, PATCHes their own profiles row and sets tier to pro,
// beta access to 2099 and the Stripe identifiers to whatever they like.
// lib/access.ts reads either of the first two as paid access, and the checkout
// and portal routes trust the third. On 2026-08-25 the hosted project still
// answered that request with 200 and the elevated values, because it never
// received 20260719001100 - so this is also the check to run against a stack
// after applying the SQL-editor block in docs/beta-runbook.md.
//
// The row policy is not what is under test. `profiles: update own` is correct;
// Postgres RLS chooses which ROW a policy admits and cannot restrict which
// COLUMN is written, so the only control is whether `authenticated` holds
// UPDATE on the table at all. The table is closed to the rider entirely rather
// than column by column, because no client-side code writes any profiles
// column: the beta signup route, the checkout customer link and the Stripe
// webhook all reach it through the service-role client. A column a rider may
// one day edit themselves needs its own `grant update (column)` in a new
// migration and its own removal from the list below, both on purpose.
//
// Needs no browser and no dev server: the rider is created through the admin
// API rather than the signup form, so BETA_INVITE_ONLY does not gate it. The
// profiles row it acts on comes from the trigger 20260816001200 installs, and
// its absence fails the setup rather than passing the checks vacuously - an
// UPDATE that matches nothing returns 200 and an empty list under a grant that
// should not exist, which is indistinguishable from a refusal if the row is
// never read back.

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

// Every column on profiles that decides what a rider is entitled to or how
// they are billed. `id` is the primary key and the RLS subject and is left
// alone; `updated_at` is neither of these and has its own check below.
const ENTITLEMENT_AND_BILLING_COLUMNS = [
  'tier',
  'beta_cohort',
  'beta_access_started_at',
  'beta_access_expires_at',
  'stripe_customer_id',
  'stripe_subscription_id',
  'stripe_price_id',
  'stripe_current_period_end',
] as const;

type EntitlementColumn = (typeof ENTITLEMENT_AND_BILLING_COLUMNS)[number];

// What the escalation wrote. The Stripe identifiers carry the rider's id so six
// device projects forging at once cannot collide on the unique indexes - a
// collision would fail the request for the wrong reason and hide an open hole.
function forgedProfile(userId: string): Record<EntitlementColumn, string> {
  const tag = userId.slice(0, 8);
  return {
    tier: 'pro',
    beta_cohort: `forged-${tag}`,
    beta_access_started_at: '2020-01-01T00:00:00+00:00',
    beta_access_expires_at: '2099-01-01T00:00:00+00:00',
    stripe_customer_id: `cus_forged_${tag}`,
    stripe_subscription_id: `sub_forged_${tag}`,
    stripe_price_id: `price_forged_${tag}`,
    stripe_current_period_end: '2099-01-01T00:00:00+00:00',
  };
}

interface Rider {
  userId: string;
  accessToken: string;
  // The rider's own session through the client the app is built on.
  client: SupabaseClient<Database>;
}

// A request as PostgREST sees it, with the outcome read back through the
// service role rather than from the response: the response says what the API
// claims happened, the row says what did. Expected in one object so a failure
// prints the status, the error code and the row that was actually stored side
// by side - `{ status: 200, code: null, row: { tier: 'pro', ... } }` is the
// escalation, in the shape it was reported.
interface Outcome {
  status: number;
  code: string | null;
  row: ProfileRow | null;
}

function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL!;
}

function anonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
}

async function readProfile(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<ProfileRow | null> {
  const { data, error } = await admin.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(`reading profiles as service_role failed: ${error.message}`);
  return data;
}

async function restRequest(
  admin: SupabaseClient<Database>,
  userId: string,
  bearer: string,
  method: 'GET' | 'PATCH',
  body?: Record<string, string>,
): Promise<Outcome> {
  const response = await fetch(`${supabaseUrl()}/rest/v1/profiles?id=eq.${userId}&select=*`, {
    method,
    headers: {
      apikey: anonKey(),
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof payload?.code === 'string' ? payload.code : null;
  return { status: response.status, code, row: await readProfile(admin, userId) };
}

// `permission denied for table profiles`: Postgres 42501, which PostgREST
// answers as 403 for a signed-in caller and as 401 for the anon role. It is
// raised at planning, before any row is matched, so it holds for a row the
// caller owns just as it does for anyone else's.
function refused(row: ProfileRow | null): Outcome {
  return { status: 403, code: '42501', row };
}

function refusedAsNobody(row: ProfileRow | null): Outcome {
  return { status: 401, code: '42501', row };
}

test.describe('a rider and their own profiles row', () => {
  test.skip(
    !hasServiceRole(),
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.',
  );
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'NEXT_PUBLIC_SUPABASE_ANON_KEY is required to send requests as the rider and as nobody.',
  );

  let admin: SupabaseClient<Database>;
  let createdUserId: string | null = null;
  let rider: Rider;
  // The row as the trigger wrote it. Every refusal below is checked against
  // this, so the checks that change the row through the service role come last.
  let baseline: ProfileRow;

  test.beforeAll(async ({}, workerInfo) => {
    admin = createTestAdminClient();

    // One throwaway rider per device project, made through the admin API so no
    // signup form and no invite gate stands between this spec and the table.
    const email = `profile-privilege-${workerInfo.project.name}-${randomUUID()}@example.com`;
    const password = `pw-${randomUUID()}`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      throw new Error(`creating the throwaway rider failed: ${createError?.message ?? 'no user'}`);
    }
    const userId = created.user.id;
    createdUserId = userId;

    const client = createClient<Database>(supabaseUrl(), anonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError || !signIn.session) {
      throw new Error(`signing in as the rider failed: ${signInError?.message ?? 'no session'}`);
    }
    rider = { userId, accessToken: signIn.session.access_token, client };

    const row = await readProfile(admin, userId);
    if (row === null) {
      throw new Error(
        'the signup trigger left no profiles row, so nothing here would be a real refusal - see 20260816001200',
      );
    }
    if (row.tier !== 'free') {
      throw new Error(`a new rider starts on the free tier, not ${row.tier}`);
    }
    baseline = row;
  });

  test.afterAll(async () => {
    // The profiles row and any vehicle go with the auth user through the FK
    // cascades. Swallowed so a cleanup failure never masks the finding.
    try {
      if (createdUserId) {
        await admin.auth.admin.deleteUser(createdUserId);
        createdUserId = null;
      }
    } catch {
      // Deliberately ignored.
    }
  });

  test('refuses the escalation sent as one request', async () => {
    const outcome = await restRequest(
      admin,
      rider.userId,
      rider.accessToken,
      'PATCH',
      forgedProfile(rider.userId),
    );

    expect(outcome).toEqual(refused(baseline));
  });

  for (const column of ENTITLEMENT_AND_BILLING_COLUMNS) {
    test(`refuses ${column} on its own`, async () => {
      // One column at a time, because a table-level grant is not the only way
      // this comes back: `grant update (tier) on profiles` reopens exactly one
      // column and passes the request above only if it names anything else.
      const outcome = await restRequest(admin, rider.userId, rider.accessToken, 'PATCH', {
        [column]: forgedProfile(rider.userId)[column],
      });

      expect(outcome).toEqual(refused(baseline));
    });
  }

  test('refuses updated_at too, so the table is closed and not merely the trusted columns', async () => {
    // Nothing a rider does edits their profile directly, so there is no
    // column-level grant to preserve, and none should appear without a reason
    // written into a migration.
    const outcome = await restRequest(admin, rider.userId, rider.accessToken, 'PATCH', {
      updated_at: '2099-01-01T00:00:00+00:00',
    });

    expect(outcome).toEqual(refused(baseline));
  });

  test('refuses the same update through supabase-js, the client the app is built on', async () => {
    const { data, error } = await rider.client
      .from('profiles')
      .update({ tier: 'pro' })
      .eq('id', rider.userId)
      .select('id, tier');

    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
    expect(await readProfile(admin, rider.userId)).toEqual(baseline);
  });

  test('gives a caller holding only the public key neither a read nor a write', async () => {
    // The anon role. Every unauthenticated write in the app goes through the
    // service client and no page reads a table before sign-in, so the role
    // holds no table privilege at all - and a refusal is what the request has
    // to get, not an empty list from a policy that merely matched nothing.
    expect(await restRequest(admin, rider.userId, anonKey(), 'GET')).toEqual(
      refusedAsNobody(baseline),
    );
    expect(
      await restRequest(admin, rider.userId, anonKey(), 'PATCH', { tier: 'pro' }),
    ).toEqual(refusedAsNobody(baseline));
  });

  test('still lets the rider read their own profile and nobody else\'s', async () => {
    const { data, error } = await rider.client.from('profiles').select('*');

    expect(error).toBeNull();
    // Other projects' throwaway riders exist in the same database while this
    // runs; the select policy keeps them out of this list.
    expect(data).toEqual([baseline]);
  });

  test('still lets the rider write the garage as themselves', async () => {
    // The tables a rider writes through their own session are granted per
    // table, so the revoke that closes profiles must not have swept them up.
    // The garage is the first thing a new rider touches.
    const { data: vehicle, error: insertError } = await rider.client
      .from('vehicles')
      .insert({ user_id: rider.userId, nickname: 'Regression bike', type: 'motorcycle' })
      .select('id, nickname')
      .single();
    expect(insertError).toBeNull();
    expect(vehicle?.nickname).toBe('Regression bike');

    const { data: renamed, error: updateError } = await rider.client
      .from('vehicles')
      .update({ nickname: 'Renamed bike' })
      .eq('id', vehicle!.id)
      .select('nickname')
      .single();
    expect(updateError).toBeNull();
    expect(renamed?.nickname).toBe('Renamed bike');

    const { error: deleteError } = await rider.client
      .from('vehicles')
      .delete()
      .eq('id', vehicle!.id);
    expect(deleteError).toBeNull();
  });

  test('still links the Stripe customer and applies the subscription through the service role', async () => {
    // The two writes that legitimately reach these columns, in the shape the
    // routes send them. app/api/stripe/checkout/route.ts links the customer
    // with `update ... .eq('id', user.id).select('id').maybeSingle()` through
    // the admin client, and app/api/stripe/webhook/route.ts applies the
    // subscription by customer id. Both run as service_role, which the revoke
    // above never touches.
    const customerId = `cus_link_${rider.userId.slice(0, 8)}`;
    const { data: linked, error: linkError } = await admin
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', rider.userId)
      .select('id')
      .maybeSingle();
    expect(linkError).toBeNull();
    expect(linked?.id).toBe(rider.userId);

    const { error: subscriptionError } = await admin
      .from('profiles')
      .update({
        tier: 'pro',
        stripe_subscription_id: `sub_link_${rider.userId.slice(0, 8)}`,
        stripe_price_id: 'price_pro_monthly',
        stripe_current_period_end: '2099-01-01T00:00:00+00:00',
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_customer_id', customerId);
    expect(subscriptionError).toBeNull();

    // Entitlement arrives through the server and the rider can read it back,
    // and still cannot touch it: the row they now hold is the one a refusal
    // has to leave in place.
    const entitled = await readProfile(admin, rider.userId);
    expect(entitled?.tier).toBe('pro');
    expect(entitled?.stripe_customer_id).toBe(customerId);
    const { data: own } = await rider.client.from('profiles').select('tier').eq('id', rider.userId).single();
    expect(own?.tier).toBe('pro');
    expect(
      await restRequest(admin, rider.userId, rider.accessToken, 'PATCH', {
        stripe_customer_id: 'cus_somebody_else',
      }),
    ).toEqual(refused(entitled));
  });
});
