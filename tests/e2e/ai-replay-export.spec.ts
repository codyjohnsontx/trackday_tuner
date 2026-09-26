import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import type { Database } from '@/types/supabase';

// `npm run ai:export-replay` against a real database: the ai_replay_export view
// (20260927002000) chooses the rows, the script writes the file, and the file
// is read back the way Redline's replay runner reads it - against the contract
// in docs/ai-replay-export.md, not against the script's own constants.
//
// tests/unit/export-ai-replay.test.ts holds the row mapper to that contract
// over fixture rows. What only a database can answer is the view's rule: a
// row is exported only while its rider is keeping, only if it was written
// after their latest opt-in, and only until its retain_until. Each of those is
// seeded here beside a row that must be exported.
//
// Needs no browser and no dev server. The view is global, so the file is read
// for this spec's own request ids; the device projects run it concurrently.

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '../..');
const DAY_MS = 24 * 60 * 60 * 1000;

const CONTRACT_KEYS = [
  'app_commit',
  'created_at',
  'format_version',
  'model',
  'redaction_version',
  'request_id',
  'retain_until',
  'rider',
  'route',
  'submitted',
  'verdict',
];
const VERDICT_KEYS = [
  'classifier_stage',
  'policy_result',
  'policy_violations',
  'refusal_reason',
  'status',
];
const SUBMITTED_KEYS: Record<string, string[]> = {
  tuning_advice: ['change_intent', 'question', 'symptoms'],
  day_plan: ['surface_condition', 'target_date', 'track_name', 'weather_condition'],
};

type Admin = SupabaseClient<Database>;

async function makeRider(admin: Admin, label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `ai-replay-${label}-${randomUUID()}@example.com`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`creating the rider failed: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

async function setKeeping(admin: Admin, userId: string, optedInAt: Date): Promise<void> {
  const { error } = await admin
    .from('profiles')
    .update({
      ai_question_retention_notice_seen_at: optedInAt.toISOString(),
      ai_question_retention_opted_in_at: optedInAt.toISOString(),
      ai_question_retention_opted_out_at: null,
    })
    .eq('id', userId);
  if (error) throw new Error(`opting the rider in failed: ${error.message}`);
}

// Capture writes the request and then its text, and the database drops the
// text unless the rider is keeping at that moment (20260926001900), so every
// row is written while its rider is keeping. A row the view must refuse is
// then moved into that state with a service-role UPDATE.
async function seedQuestion(
  admin: Admin,
  userId: string,
  route: 'tuning_advice' | 'day_plan',
  submitted: Record<string, unknown>,
): Promise<string> {
  const requestId = randomUUID();
  const { error: requestError } = await admin.from('ai_requests').insert({
    user_id: userId,
    request_id: requestId,
    status: 'completed_refusal_prompt_injection',
    refusal_reason: 'prompt_injection',
    policy_result: 'force_refusal',
    classifier_stage: 'preflight',
    app_commit: 'e2e-commit',
  });
  if (requestError) throw new Error(`seeding ai_requests failed: ${requestError.message}`);

  const { error: textError } = await admin.from('ai_request_text').insert({
    request_id: requestId,
    user_id: userId,
    route,
    submitted: submitted as Database['public']['Tables']['ai_request_text']['Insert']['submitted'],
    redaction_version: 1,
  });
  if (textError) throw new Error(`seeding ai_request_text failed: ${textError.message}`);

  const { data, error } = await admin
    .from('ai_request_text')
    .select('request_id')
    .eq('request_id', requestId);
  if (error || data.length !== 1) {
    throw new Error(`the text row for ${requestId} was not kept; is the rider keeping?`);
  }
  return requestId;
}

async function moveText(
  admin: Admin,
  requestId: string,
  values: { created_at?: string; retain_until?: string },
): Promise<void> {
  const { error } = await admin.from('ai_request_text').update(values).eq('request_id', requestId);
  if (error) throw new Error(`dating ai_request_text failed: ${error.message}`);
}

test.describe('npm run ai:export-replay', () => {
  test.skip(!hasServiceRole(), 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

  const riders: string[] = [];
  let admin: Admin;
  let dir: string;

  test.beforeAll(() => {
    admin = createTestAdminClient();
    dir = mkdtempSync(path.join(os.tmpdir(), 'ai-replay-export-'));
  });

  test.afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    for (const userId of riders) await admin.auth.admin.deleteUser(userId);
  });

  test('writes the kept questions a replay runner can read, and nothing it may not', async () => {
    const now = Date.now();

    const keeper = await makeRider(admin, 'keeper');
    const lapsed = await makeRider(admin, 'lapsed');
    riders.push(keeper, lapsed);

    await setKeeping(admin, keeper, new Date(now - 10 * DAY_MS));
    await setKeeping(admin, lapsed, new Date(now - 10 * DAY_MS));

    const question = await seedQuestion(admin, keeper, 'tuning_advice', {
      question: 'Front pushes mid-corner, call me on [phone]',
      symptoms: ['understeer_mid'],
      change_intent: 'better_feel',
    });
    const dayPlan = await seedQuestion(admin, keeper, 'day_plan', {
      track_name: 'Road Atlanta',
      weather_condition: 'dry',
      surface_condition: null,
      target_date: '2026-10-05',
    });

    // Past its retain_until: the purge has not run yet, the export must not wait for it.
    const expired = await seedQuestion(admin, keeper, 'tuning_advice', {
      question: 'Expired question',
      symptoms: [],
      change_intent: null,
    });
    await moveText(admin, expired, { retain_until: new Date(now - DAY_MS).toISOString() });

    // Written before the rider's latest opt-in: consent is judged at write time.
    const beforeOptIn = await seedQuestion(admin, keeper, 'tuning_advice', {
      question: 'Question from before the latest opt-in',
      symptoms: [],
      change_intent: null,
    });
    // The 90-day CHECK is on created_at, so retain_until moves back with it.
    await moveText(admin, beforeOptIn, {
      created_at: new Date(now - 20 * DAY_MS).toISOString(),
      retain_until: new Date(now + 60 * DAY_MS).toISOString(),
    });

    // A rider who turned keeping off after asking, whose held row the delete missed.
    const optedOut = await seedQuestion(admin, lapsed, 'tuning_advice', {
      question: 'Question from a rider who turned keeping off',
      symptoms: [],
      change_intent: null,
    });
    const { error: offError } = await admin
      .from('profiles')
      .update({
        ai_question_retention_opted_out_at: new Date(now).toISOString(),
        ai_question_retention_opted_in_at: null,
      })
      .eq('id', lapsed);
    if (offError) throw new Error(`opting the rider out failed: ${offError.message}`);

    const out = path.join(dir, 'replay.jsonl');
    await execFileAsync(process.execPath, ['scripts/export-ai-replay.mjs', '--out', out], {
      cwd: ROOT,
      env: process.env,
    });

    expect(statSync(out).mode & 0o777, 'the file is readable by its owner only').toBe(0o600);

    const text = readFileSync(out, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    const lines = text.split('\n').slice(0, -1).map((line) => JSON.parse(line));

    // Every line in the file meets the contract, not only this spec's.
    for (const line of lines) {
      expect(Object.keys(line).sort()).toEqual(CONTRACT_KEYS);
      expect(Object.keys(line.verdict).sort()).toEqual(VERDICT_KEYS);
      expect(Object.keys(line.submitted).sort()).toEqual(SUBMITTED_KEYS[line.route]);
      expect(line.format_version).toBe(1);
      expect(line.rider).toMatch(/^[0-9a-f]{64}$/);
      expect(Date.parse(line.retain_until)).toBeGreaterThan(now - 60_000);
    }

    for (const userId of [keeper, lapsed]) expect(text).not.toContain(userId);

    const byId = new Map(lines.map((line) => [line.request_id, line]));
    expect([...byId.keys()]).toEqual(expect.arrayContaining([question, dayPlan]));
    for (const refused of [expired, beforeOptIn, optedOut]) expect(byId.has(refused)).toBe(false);

    const asked = byId.get(question);
    expect(asked.route).toBe('tuning_advice');
    expect(asked.submitted).toEqual({
      question: 'Front pushes mid-corner, call me on [phone]',
      symptoms: ['understeer_mid'],
      change_intent: 'better_feel',
    });
    expect(asked.verdict).toEqual({
      status: 'completed_refusal_prompt_injection',
      refusal_reason: 'prompt_injection',
      policy_result: 'force_refusal',
      policy_violations: [],
      classifier_stage: 'preflight',
    });
    expect(asked.app_commit).toBe('e2e-commit');
    expect(byId.get(dayPlan).rider, 'one rider groups within a file').toBe(asked.rider);

    // The rider deletes a question after the first export. The next export is a
    // whole snapshot that replaces Redline's copy, so it no longer carries it,
    // and it names the same rider differently.
    const { error: deleteError } = await admin.from('ai_request_text').delete().eq('request_id', dayPlan);
    if (deleteError) throw new Error(`deleting the question failed: ${deleteError.message}`);
    const second = path.join(dir, 'replay-2.jsonl');
    await execFileAsync(process.execPath, ['scripts/export-ai-replay.mjs', '--out', second], {
      cwd: ROOT,
      env: process.env,
    });
    const secondLines = readFileSync(second, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(secondLines.some((line) => line.request_id === dayPlan)).toBe(false);
    const again = secondLines.find((line) => line.request_id === question);
    expect(again.rider).not.toBe(asked.rider);

    // It will not overwrite an export already on disk.
    await expect(
      execFileAsync(process.execPath, ['scripts/export-ai-replay.mjs', '--out', out], {
        cwd: ROOT,
        env: process.env,
      }),
    ).rejects.toThrow(/cannot create/);
  });

  test('is closed to the Data API for anyone but the service role', async () => {
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    test.skip(!anonKey, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required to ask as nobody.');

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/ai_replay_export`, {
      headers: { apikey: anonKey!, Authorization: `Bearer ${anonKey}` },
    });
    const body = await response.json();
    expect(body.code, JSON.stringify(body)).toBe('42501');
  });
});
