import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createTestAdminClient, expectRows, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import type { Database } from '@/types/supabase';

// The database half of 20260924001700: retained rider question text is deleted
// once it passes retain_until, and a rider can read and delete their own and
// do nothing else to it.
//
// tests/unit/migrations-bootstrap.test.ts reads the grants as text and
// tests/unit/hosted-ai-request-text-runbook.test.ts keeps the hosted copy in
// step; neither can say the purge function runs or that PostgREST refuses what
// the grants withhold. This asks a real stack. Run it against a database rebuilt
// from the migrations, and against hosted after the SQL-editor block.
//
// Needs no browser and no dev server. What it cannot prove is that pg_cron
// fires on schedule: it calls the function the job calls. `select jobname from
// cron.job` on the stack, and `/api/health`'s ai_text_retention check, are the
// other two halves (docs/beta-runbook.md, "Apply the AI question-text table").
//
// The purge is global - it deletes every expired row, not this spec's - so each
// assertion reads this spec's own rows back rather than counting what the
// function says it removed; the device projects run it concurrently.

type TextRow = Database['public']['Tables']['ai_request_text']['Row'];

const DAY_MS = 24 * 60 * 60 * 1000;

interface Rider {
  userId: string;
  client: SupabaseClient<Database>;
}

function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL!;
}

function anonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
}

async function makeRider(admin: SupabaseClient<Database>, label: string): Promise<Rider> {
  const email = `ai-text-${label}-${randomUUID()}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(`creating the throwaway rider failed: ${createError?.message ?? 'no user'}`);
  }
  const client = createClient<Database>(supabaseUrl(), anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signing in as the rider failed: ${signInError.message}`);
  return { userId: created.user.id, client };
}

// An ai_requests row and, optionally, its text. The foreign key needs the
// request first, the way the capture step will write them.
async function seedRequest(
  admin: SupabaseClient<Database>,
  userId: string,
  options: { createdAt: Date; retainUntil?: Date; preview?: string },
): Promise<string> {
  const requestId = `e2e-ai-text-${randomUUID()}`;
  const { error: requestError } = await admin.from('ai_requests').insert({
    user_id: userId,
    request_id: requestId,
    status: 'completed',
    created_at: options.createdAt.toISOString(),
    prompt_redacted_preview: options.preview ?? null,
  });
  if (requestError) throw new Error(`seeding ai_requests failed: ${requestError.message}`);

  if (options.retainUntil) {
    const { error: textError } = await admin.from('ai_request_text').insert({
      request_id: requestId,
      user_id: userId,
      route: 'tuning_advice',
      submitted: {
        question: 'Front pushes mid-corner on the brakes, what should I try?',
        symptoms: [],
        change_intent: null,
      },
      redaction_version: 1,
      created_at: options.createdAt.toISOString(),
      retain_until: options.retainUntil.toISOString(),
    });
    if (textError) throw new Error(`seeding ai_request_text failed: ${textError.message}`);
  }
  return requestId;
}

async function textRow(admin: SupabaseClient<Database>, requestId: string): Promise<TextRow | null> {
  const rows = expectRows(
    await admin.from('ai_request_text').select('*').eq('request_id', requestId),
    'reading ai_request_text as service_role',
  );
  return rows[0] ?? null;
}

async function preview(admin: SupabaseClient<Database>, requestId: string): Promise<string | null> {
  const rows = expectRows(
    await admin.from('ai_requests').select('prompt_redacted_preview').eq('request_id', requestId),
    'reading ai_requests as service_role',
  );
  expect(rows, `ai_requests row ${requestId} is kept by the purge`).toHaveLength(1);
  return rows[0].prompt_redacted_preview;
}

test.describe('retained AI question text', () => {
  test.skip(!hasServiceRole(), 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'NEXT_PUBLIC_SUPABASE_ANON_KEY is required to send requests as a rider and as nobody.',
  );

  let admin: SupabaseClient<Database>;
  let rider: Rider;
  let otherRider: Rider;

  test.beforeAll(async ({}, workerInfo) => {
    admin = createTestAdminClient();
    rider = await makeRider(admin, `${workerInfo.project.name}-a`);
    otherRider = await makeRider(admin, `${workerInfo.project.name}-b`);
    // `rider` has seen the retention notice, so a fresh preview of theirs is
    // kept; `otherRider` has not, so nothing of theirs is.
    const { error } = await admin
      .from('profiles')
      .update({ ai_question_retention_notice_seen_at: new Date().toISOString() })
      .eq('id', rider.userId);
    if (error) throw new Error(`recording the notice as seen failed: ${error.message}`);
  });

  test.afterAll(async () => {
    // Deleting the accounts cascades through user_id on both tables.
    for (const userId of [rider?.userId, otherRider?.userId]) {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test('the purge deletes expired text and 90-day-old previews and keeps the rest', async () => {
    const now = Date.now();
    const expired = await seedRequest(admin, rider.userId, {
      createdAt: new Date(now - 91 * DAY_MS),
      retainUntil: new Date(now - DAY_MS),
      preview: 'front pushes mid-corner',
    });
    const fresh = await seedRequest(admin, rider.userId, {
      createdAt: new Date(now - DAY_MS),
      retainUntil: new Date(now + 89 * DAY_MS),
      preview: 'rear steps out on exit',
    });

    const { data: removed, error } = await admin.rpc('purge_expired_ai_request_text');
    expect(error).toBeNull();
    expect(typeof removed).toBe('number');

    expect(await textRow(admin, expired)).toBeNull();
    expect(await preview(admin, expired)).toBeNull();

    expect(await textRow(admin, fresh)).not.toBeNull();
    expect(await preview(admin, fresh)).toBe('rear steps out on exit');
  });

  // Nothing of a rider's is kept until they have seen the notice. The routes
  // still write a preview for everyone until capture gates that write, so the
  // purge is what clears it - and it keeps the request row, which is the rate
  // limit.
  test('the purge clears a fresh preview for a rider who has not seen the notice', async () => {
    const now = Date.now();
    const unacknowledged = await seedRequest(admin, otherRider.userId, {
      createdAt: new Date(now - 60 * 1000),
      preview: 'asked before seeing the notice',
    });
    const acknowledged = await seedRequest(admin, rider.userId, {
      createdAt: new Date(now - 60 * 1000),
      preview: 'asked after seeing the notice',
    });

    // Only the acknowledged side is asserted on the view: the purge is global,
    // so another device project's run may already have cleared the other one,
    // which then correctly leaves the view.
    const pending = expectRows(
      await admin
        .from('ai_requests_unacknowledged_previews')
        .select('request_id')
        .in('request_id', [unacknowledged, acknowledged]),
      'reading the unacknowledged-previews view as service_role',
    );
    expect(pending.map((row) => row.request_id)).not.toContain(acknowledged);

    const { error } = await admin.rpc('purge_expired_ai_request_text');
    expect(error).toBeNull();

    expect(await preview(admin, unacknowledged)).toBeNull();
    expect(await preview(admin, acknowledged)).toBe('asked after seeing the notice');
  });

  test('a rider cannot read the unacknowledged-previews view', async () => {
    const { error } = await rider.client.from('ai_requests_unacknowledged_previews').select('request_id');
    expect(error?.code).toBe('42501');
  });

  // A deadline earlier than 90 days is allowed - deleting sooner breaks no
  // promise - and the purge honours it even on a row created moments ago.
  test('the purge deletes recent text whose own deadline has passed', async () => {
    const now = Date.now();
    const earlyDeadline = await seedRequest(admin, rider.userId, {
      createdAt: new Date(now - 60 * 1000),
      retainUntil: new Date(now - 1000),
    });

    const { error } = await admin.rpc('purge_expired_ai_request_text');
    expect(error).toBeNull();
    expect(await textRow(admin, earlyDeadline)).toBeNull();
  });

  // The purge and the health check both trust retain_until, so a writer that
  // set it past 90 days would keep text past the notice and read as healthy.
  // The database refuses the row instead.
  test('the database refuses a deadline more than 90 days after creation', async () => {
    const now = Date.now();
    const requestId = await seedRequest(admin, rider.userId, { createdAt: new Date(now) });

    const { error } = await admin.from('ai_request_text').insert({
      request_id: requestId,
      user_id: rider.userId,
      route: 'tuning_advice',
      submitted: { question: 'kept too long' },
      redaction_version: 1,
      created_at: new Date(now).toISOString(),
      retain_until: new Date(now + 91 * DAY_MS).toISOString(),
    });
    expect(error?.code).toBe('23514');
    expect(await textRow(admin, requestId)).toBeNull();
  });

  // RLS trusts user_id on the text row, so a row naming another rider under
  // this rider's request would show this rider's question to them. The
  // service writer is the one that could get it wrong, so the service role is
  // what sends it, and the composite foreign key is what refuses it.
  test('the database refuses text owned by someone other than its request\'s rider', async () => {
    const requestId = await seedRequest(admin, rider.userId, {
      createdAt: new Date(),
      preview: 'rider A question',
    });

    const { error } = await admin.from('ai_request_text').insert({
      request_id: requestId,
      user_id: otherRider.userId,
      route: 'tuning_advice',
      submitted: { question: 'rider A question' },
      redaction_version: 1,
    });
    expect(error?.code).toBe('23503');
    expect(await textRow(admin, requestId)).toBeNull();

    const visibleToOther = expectRows(
      await otherRider.client.from('ai_request_text').select('request_id').eq('request_id', requestId),
      'reading ai_request_text as the other rider',
    );
    expect(visibleToOther).toEqual([]);
  });

  test('a rider cannot run the purge', async () => {
    const { error } = await rider.client.rpc('purge_expired_ai_request_text');
    expect(error?.code).toBe('42501');
  });

  test('a rider reads their own text and never another rider\'s', async () => {
    const now = Date.now();
    const mine = await seedRequest(admin, rider.userId, {
      createdAt: new Date(now),
      retainUntil: new Date(now + 90 * DAY_MS),
    });
    const theirs = await seedRequest(admin, otherRider.userId, {
      createdAt: new Date(now),
      retainUntil: new Date(now + 90 * DAY_MS),
    });

    const visible = expectRows(
      await rider.client.from('ai_request_text').select('request_id').in('request_id', [mine, theirs]),
      'reading ai_request_text as the rider',
    );
    expect(visible.map((row) => row.request_id)).toEqual([mine]);
  });

  // RLS picks the row and cannot restrict the column, so an UPDATE on their own
  // row would let a rider keep text past the 90 days the notice promises.
  test('a rider cannot move retain_until on their own text', async () => {
    const now = Date.now();
    const retainUntil = new Date(now + 90 * DAY_MS);
    const mine = await seedRequest(admin, rider.userId, { createdAt: new Date(now), retainUntil });

    const { error } = await rider.client
      .from('ai_request_text')
      .update({ retain_until: '2099-01-01T00:00:00+00:00' })
      .eq('request_id', mine);
    expect(error?.code).toBe('42501');
    expect(new Date((await textRow(admin, mine))!.retain_until).getTime()).toBe(retainUntil.getTime());
  });

  test('a rider cannot plant text', async () => {
    const requestId = await seedRequest(admin, rider.userId, { createdAt: new Date() });

    const { error } = await rider.client.from('ai_request_text').insert({
      request_id: requestId,
      user_id: rider.userId,
      route: 'tuning_advice',
      submitted: { question: 'planted' },
      redaction_version: 1,
    });
    expect(error?.code).toBe('42501');
    expect(await textRow(admin, requestId)).toBeNull();
  });

  test('a rider deletes their own text and cannot delete another rider\'s', async () => {
    const now = Date.now();
    const mine = await seedRequest(admin, rider.userId, {
      createdAt: new Date(now),
      retainUntil: new Date(now + 90 * DAY_MS),
    });
    const theirs = await seedRequest(admin, otherRider.userId, {
      createdAt: new Date(now),
      retainUntil: new Date(now + 90 * DAY_MS),
    });

    const own = await rider.client.from('ai_request_text').delete().eq('request_id', mine);
    expect(own.error).toBeNull();
    expect(await textRow(admin, mine)).toBeNull();
    // The rate-limit row stays: deleting text must never reset a rate limit.
    expect(await preview(admin, mine)).toBeNull();

    const other = await rider.client.from('ai_request_text').delete().eq('request_id', theirs);
    expect(other.error).toBeNull();
    expect(await textRow(admin, theirs)).not.toBeNull();
  });

  test('nobody signed in reads nothing', async () => {
    const response = await fetch(`${supabaseUrl()}/rest/v1/ai_request_text?select=request_id`, {
      headers: { apikey: anonKey(), Authorization: `Bearer ${anonKey()}` },
    });
    const payload = (await response.json().catch(() => null)) as { code?: unknown } | null;
    expect({ status: response.status, code: payload?.code }).toEqual({ status: 401, code: '42501' });
  });
});
