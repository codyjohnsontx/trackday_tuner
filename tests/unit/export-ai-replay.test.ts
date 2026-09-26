import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
// The export is plain JS so it runs under node with no build step, like the
// migration-audit generator. There are no types and `allowJs` is off, so the
// import carries a directive on the module-specifier line.
// @ts-expect-error - see above.
import { newPseudonymKey, parseArgs, toReplayRecord, viewRows } from '@/scripts/export-ai-replay.mjs';

/**
 * `npm run ai:export-replay` copies riders' kept question text out of the
 * database for Redline. What it must never copy is anything that joins a line
 * back to an account: user_id, session_id, vehicle_id, or a rider id that is
 * the same in two exports. This runs the row mapper over rows carrying all of
 * those - more than the view selects, so a later wider select is covered too -
 * and reads what comes out.
 *
 * docs/ai-replay-export.md is the contract Redline's reader tests against, so
 * its example line is parsed here and held to the mapper's shape.
 */

const USER_A = '6f1d2c3b-4a59-4e8f-9d0c-1b2a3c4d5e6f';
const USER_B = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';
const SESSION_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f';
const VEHICLE_ID = 'e5f6a7b8-c9d0-4e1f-9a2b-3c4d5e6f7a8b';

// The view's rider_key: SHA-256 hex of the user id, as the migration computes it.
const RIDER_KEY_A = 'a'.repeat(64);
const RIDER_KEY_B = 'b'.repeat(64);

const SECRET_KEYS = ['user_id', 'session_id', 'vehicle_id', 'rider_key'];

function tuningRow(overrides: Record<string, unknown> = {}) {
  return {
    request_id: 'req-tuning-1',
    route: 'tuning_advice',
    created_at: '2026-10-03T14:12:09.412+00:00',
    retain_until: '2027-01-01T14:12:09.412+00:00',
    submitted: {
      question: 'Front pushes mid-corner on the brakes',
      symptoms: ['understeer_mid'],
      change_intent: 'better_feel',
      // Never written by capture; here to prove the jsonb is filtered, not copied.
      vehicle_id: VEHICLE_ID,
      session_id: SESSION_ID,
    },
    redaction_version: 1,
    rider_key: RIDER_KEY_A,
    app_commit: '852a615',
    status: 'completed_refusal_prompt_injection',
    refusal_reason: 'prompt_injection',
    policy_result: 'force_refusal',
    policy_violations: [],
    classifier_stage: 'preflight',
    model: null,
    user_id: USER_A,
    session_id: SESSION_ID,
    vehicle_id: VEHICLE_ID,
    ...overrides,
  };
}

function dayPlanRow(overrides: Record<string, unknown> = {}) {
  return {
    request_id: 'req-day-1',
    route: 'day_plan',
    created_at: '2026-10-04T08:00:00+00:00',
    retain_until: '2027-01-02T08:00:00+00:00',
    submitted: {
      track_name: 'Road Atlanta',
      weather_condition: 'dry',
      surface_condition: null,
      target_date: '2026-10-05',
      user_id: USER_B,
    },
    redaction_version: 1,
    rider_key: RIDER_KEY_B,
    app_commit: null,
    status: 'ok',
    refusal_reason: null,
    policy_result: 'pass',
    policy_violations: [],
    classifier_stage: null,
    model: 'gpt-5.4-mini-2026-03-17',
    user_id: USER_B,
    session_id: null,
    vehicle_id: VEHICLE_ID,
    ...overrides,
  };
}

function keysDeep(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      found.push(key);
      keysDeep(inner, found);
    }
  }
  return found;
}

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return 'array';
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, inner]) => [key, shape(inner)]),
    );
  }
  return 'leaf';
}

describe('toReplayRecord', () => {
  const rows = [tuningRow(), dayPlanRow()];

  it('lets no user_id, session_id, vehicle_id or rider_key survive, as a key or as a value', () => {
    const records = rows.map((row) => toReplayRecord(row, newPseudonymKey()));
    const text = JSON.stringify(records);

    for (const key of SECRET_KEYS) expect(keysDeep(records)).not.toContain(key);
    for (const secret of [USER_A, USER_B, SESSION_ID, VEHICLE_ID, RIDER_KEY_A, RIDER_KEY_B]) {
      expect(text).not.toContain(secret);
    }
  });

  it('gives a rider a different pseudonym in each run', () => {
    const first = toReplayRecord(tuningRow(), newPseudonymKey());
    const second = toReplayRecord(tuningRow(), newPseudonymKey());

    expect(first.rider).toMatch(/^[0-9a-f]{64}$/);
    expect(second.rider).toMatch(/^[0-9a-f]{64}$/);
    expect(first.rider).not.toBe(second.rider);
  });

  it('groups one rider inside a run and keeps two riders apart', () => {
    const key = newPseudonymKey();
    const a1 = toReplayRecord(tuningRow(), key);
    const a2 = toReplayRecord(tuningRow({ request_id: 'req-tuning-2' }), key);
    const b = toReplayRecord(dayPlanRow(), key);

    expect(a1.rider).toBe(a2.rider);
    expect(a1.rider).not.toBe(b.rider);
  });

  it('writes each route its own submitted keys, every one present', () => {
    const key = newPseudonymKey();

    expect(toReplayRecord(tuningRow(), key).submitted).toEqual({
      question: 'Front pushes mid-corner on the brakes',
      symptoms: ['understeer_mid'],
      change_intent: 'better_feel',
    });
    expect(
      toReplayRecord(dayPlanRow({ submitted: { target_date: '2026-10-05' } }), key).submitted,
    ).toEqual({
      track_name: null,
      weather_condition: null,
      surface_condition: null,
      target_date: '2026-10-05',
    });
  });

  it('carries the verdict and the deletion date the copy is bound by', () => {
    const record = toReplayRecord(tuningRow(), newPseudonymKey());

    expect(record.retain_until).toBe('2027-01-01T14:12:09.412+00:00');
    expect(record.verdict).toEqual({
      status: 'completed_refusal_prompt_injection',
      refusal_reason: 'prompt_injection',
      policy_result: 'force_refusal',
      policy_violations: [],
      classifier_stage: 'preflight',
    });
  });

  it('refuses a row with no rider key or an unknown route rather than writing it', () => {
    const key = newPseudonymKey();
    expect(() => toReplayRecord(tuningRow({ rider_key: null }), key)).toThrow(/rider_key/);
    expect(() => toReplayRecord(tuningRow({ route: 'recommendation_feedback' }), key)).toThrow(
      /unknown route/,
    );
  });
});

describe('the contract in docs/ai-replay-export.md', () => {
  const doc = readFileSync(path.resolve(__dirname, '../../docs/ai-replay-export.md'), 'utf8');
  const marker = '<!-- replay-record-example -->';
  const start = doc.indexOf('```json', doc.indexOf(marker));
  const example = JSON.parse(doc.slice(start + '```json'.length, doc.indexOf('\n```', start + 1)));

  it('shows exactly the shape the script writes', () => {
    const written = toReplayRecord(tuningRow(), newPseudonymKey());
    expect(shape(example)).toEqual(shape(written));
    expect(example.format_version).toBe(written.format_version);
  });
});

describe('parseArgs', () => {
  it('reads --since and --until as inclusive UTC days', () => {
    expect(
      parseArgs(['--since', '2026-10-01', '--until', '2026-12-31', '--out', 'replay.jsonl']),
    ).toEqual({
      since: '2026-10-01T00:00:00.000Z',
      until: '2027-01-01T00:00:00.000Z',
      out: 'replay.jsonl',
    });
  });
});

/**
 * A stand-in for PostgREST serving `ai_replay_export`, behind the real
 * supabase-js client so the query the script builds is the one read. It
 * answers the filters, order, limit and offset the script can send, and after
 * the first page it drops a row that page held - what retain_until passing, the
 * purge or a rider opting out does to the view mid-export.
 */
function shrinkingView(total: number) {
  let rows = Array.from({ length: total }, (_, i) => ({
    request_id: `00000000-0000-4000-8000-00000000000${i}`,
    created_at: `2026-10-0${1 + Math.floor(i / 2)}T12:00:00.123456+00:00`,
  }));
  let served = 0;

  const fetch = async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const params = url.searchParams;
    let visible = rows;
    for (const filter of params.getAll('created_at')) {
      const dot = filter.indexOf('.');
      const op = filter.slice(0, dot);
      const bound = Date.parse(filter.slice(dot + 1));
      visible = visible.filter((row) =>
        op === 'gte' ? Date.parse(row.created_at) >= bound : Date.parse(row.created_at) < bound,
      );
    }
    const or = params.get('or');
    if (or) {
      const match = /^\(created_at\.gt\."([^"]+)",and\(created_at\.eq\."([^"]+)",request_id\.gt\.([^)]+)\)\)$/.exec(or);
      if (!match) throw new Error(`the stand-in does not read or=${or}`);
      const [, after, at, id] = match;
      visible = visible.filter(
        (row) =>
          Date.parse(row.created_at) > Date.parse(after) ||
          (Date.parse(row.created_at) === Date.parse(at) && row.request_id > id),
      );
    }
    const offset = Number(params.get('offset') ?? 0);
    const limit = Number(params.get('limit') ?? visible.length);
    const page = visible.slice(offset, offset + limit);

    served += 1;
    if (served === 1) rows = rows.filter((row) => row.request_id !== page[1].request_id);
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return {
    client: createClient('http://view.test', 'service-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch },
    }),
    remaining: () => rows.map((row) => row.request_id),
  };
}

describe('viewRows', () => {
  it('reads every row still in the view when an earlier one leaves it between pages', async () => {
    const view = shrinkingView(7);
    const read: string[] = [];
    for await (const row of viewRows(view.client, { since: null, until: null }, 3)) {
      read.push(row.request_id);
    }
    expect(read).toEqual(expect.arrayContaining(view.remaining()));
    expect(new Set(read).size).toBe(read.length);
  });
});
