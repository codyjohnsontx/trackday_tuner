import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE ROUTE MUST OFFER THE POLICY THE SAME SESSION IDS ITS PROMPT PRINTED.
 *
 * `tests/unit/ai-session-evidence-ids.test.ts` holds the prompt and the id set
 * to each other. Neither can see the route deciding, on its own, to hand
 * `evaluateAdvicePolicy` a different set - which is exactly what it used to do:
 * it built the allowed ids from `{session, similarSessions, feedback,
 * recommendations}` and left out `previousSession`, the session its own prompt
 * prints and instructs the model to diagnose with.
 *
 * So `evaluateAdvicePolicy` is REAL here and only the model is mocked. What the
 * rider gets back is what these assertions read.
 */

const {
  getRealUser,
  getUserProfile,
  createClient,
  createAdminClient,
  generateTuningAdvice,
  loadRaceEngineerContext,
} = vi.hoisted(() => ({
  getRealUser: vi.fn(),
  getUserProfile: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  generateTuningAdvice: vi.fn(),
  loadRaceEngineerContext: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getRealUser }));
vi.mock('@/lib/actions/vehicles', () => ({ getUserProfile }));
vi.mock('@/lib/supabase/server', () => ({ createClient }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
vi.mock('@/lib/env.server', () => ({
  getAiRateLimitPerHour: vi.fn(() => 20),
  getAiRateLimitPerMinute: vi.fn(() => 3),
  getAiRequestFingerprintSecret: vi.fn(() => 'test-secret'),
}));
vi.mock('@/lib/rag/advice', () => ({
  generateTuningAdvice,
  UpstreamTimeoutError: class UpstreamTimeoutError extends Error {},
}));
vi.mock('@/lib/rag/race-engineer-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rag/race-engineer-context')>()),
  loadRaceEngineerContext,
  createRecommendationSnapshot: vi.fn(() => ({})),
}));

import { POST } from '@/app/api/ai/tuning-advice/route';
import type { AdviceResponse } from '@/lib/rag/schema';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const VEHICLE_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const PREVIOUS_SESSION_ID = '44444444-4444-4444-4444-444444444444';
const INVENTED_SESSION_ID = '99999999-9999-4999-8999-999999999999';

/** What the captain typed, and what the refusal screen then suggested he ask. */
const CAPTAIN_QUESTION = 'Front tire slid mid-corner after raising pressure 3 psi';
const SUGGESTED_QUESTION =
  'Front pushed on entry after I raised pressure 1 psi. What should I try next?';

function sessionRow(id: string, startTime: string, pressure: string) {
  return {
    id,
    user_id: USER_ID,
    vehicle_id: VEHICLE_ID,
    track_id: null,
    track_name: 'Barber Motorsports Park',
    date: '2026-09-06',
    start_time: startTime,
    session_number: startTime === '11:20:00' ? 3 : 2,
    conditions: 'sunny',
    tires: {
      front: { brand: 'Pirelli', compound: 'SC2', pressure },
      rear: { brand: 'Pirelli', compound: 'SC1', pressure: '25.0 psi' },
      condition: 'scrubbed',
    },
    suspension: {
      front: { preload: '3 turns', compression: '8 clicks', rebound: '10 clicks', direction: 'in' },
      rear: { preload: '5 clicks', compression: '9 clicks', rebound: '11 clicks', direction: 'in' },
    },
    alignment: null,
    enabled_modules: null,
    extra_modules: null,
    notes: null,
    created_at: `2026-09-06T${startTime}.000Z`,
    updated_at: `2026-09-06T${startTime}.000Z`,
  };
}

const CURRENT_ROW = sessionRow(SESSION_ID, '11:20:00', '32.5 psi');
const PREVIOUS_ROW = sessionRow(PREVIOUS_SESSION_ID, '09:40:00', '29.5 psi');

const VEHICLE_ROW = {
  id: VEHICLE_ID,
  user_id: USER_ID,
  nickname: 'ZX-6R',
  type: 'motorcycle',
  year: 2019,
  make: 'Kawasaki',
  model: 'ZX-6R',
  photo_url: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

/** A rider with two logged sessions and nothing else - the shape that refused. */
function serverClient() {
  const sessions = {
    eq: vi.fn(() => sessions),
    neq: vi.fn(() => sessions),
    or: vi.fn(() => sessions),
    lt: vi.fn(() => sessions),
    lte: vi.fn(() => sessions),
    order: vi.fn(() => sessions),
    limit: vi.fn(async () => ({ data: [CURRENT_ROW, PREVIOUS_ROW], error: null })),
    single: vi.fn(async () => ({ data: CURRENT_ROW, error: null })),
  };
  const vehicles = {
    eq: vi.fn(() => vehicles),
    single: vi.fn(async () => ({ data: VEHICLE_ROW, error: null })),
  };
  return {
    from: vi.fn((table: string) => {
      if (table === 'sessions') return { select: vi.fn(() => sessions) };
      if (table === 'vehicles') return { select: vi.fn(() => vehicles) };
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

interface Row {
  request_id: string;
  status: string;
  policy_violations?: string[] | null;
}

function adminClient(rows: Row[]) {
  const query = {
    eq: () => query,
    neq: () => query,
    in: () => query,
    gte: () => query,
    order: () => query,
    limit: () => query,
    then(resolve: (value: unknown) => void) {
      resolve({ data: [], count: 0, error: null });
    },
  };
  return {
    from: vi.fn((table: string) => {
      if (table === 'ai_recommendations') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: 'rec-1' }, error: null })),
            })),
          })),
        };
      }
      return {
        insert: vi.fn(async (row: Row) => {
          rows.push(row);
          return { error: null };
        }),
        update: vi.fn((patch: Partial<Row>) => ({
          eq: vi.fn(async (_field: string, value: string) => {
            for (const row of rows) if (row.request_id === value) Object.assign(row, patch);
            return { error: null };
          }),
        })),
        delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
        select: vi.fn(() => query),
      };
    }),
  };
}

function adviceCiting(sourceSessionId: string): AdviceResponse {
  return {
    summary: 'Take the front pressure back toward where it was.',
    recommended_changes: [
      {
        component: 'front_tire_pressure',
        direction: 'decrease',
        magnitude: '1 psi',
        reason: 'The front started sliding once the pressure went up.',
      },
    ],
    tradeoffs: [],
    confidence: 'medium',
    safety_notes: [],
    citations: [
      {
        source: 'docs/knowledge-base/tires/pressure-basics.md',
        snippet: 'Cold pressure is what you set; hot pressure is what matters.',
      },
    ],
    prediction: {
      expected_effect: 'The front should stop letting go mid-corner.',
      day_trend: 'stable',
      watch_items: ['Hot front pressure at the end of the session'],
    },
    personal_evidence: [
      {
        label: 'Earlier session',
        detail: 'You ran 29.5 psi in the front and the slide was not there.',
        source_session_id: sourceSessionId,
      },
    ],
    data_used: {
      manual: true,
      weather: true,
      history: false,
      feedback: false,
      lap_data: false,
      telemetry: false,
    },
    refusal: null,
  };
}

async function ask(question: string) {
  return POST(
    new Request('http://localhost/api/ai/tuning-advice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: SESSION_ID,
        vehicle_id: VEHICLE_ID,
        question,
        temperature_c: 24,
      }),
    }),
  );
}

const UNVERIFIED_EVIDENCE_REFUSAL =
  'I could not verify the historical session evidence referenced in that response';

describe('the race engineer answers the questions it suggests', () => {
  let rows: Row[];

  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    getRealUser.mockResolvedValue({ id: USER_ID });
    getUserProfile.mockResolvedValue({ tier: 'pro', beta_access_expires_at: null });
    createClient.mockResolvedValue(serverClient());
    createAdminClient.mockReturnValue(adminClient(rows));
    loadRaceEngineerContext.mockResolvedValue({
      similarSessions: [],
      sessionEnvironment: null,
      recentFeedback: [],
      recentRecommendations: [],
      memory: null,
      telemetrySummary: null,
      dayTrend: 'No environment snapshot is logged for this session.',
      dataUsed: {
        manual: true,
        weather: false,
        history: false,
        feedback: false,
        lap_data: false,
        telemetry: false,
      },
    });
  });

  it('answers when the model cites the session the request is about', async () => {
    generateTuningAdvice.mockResolvedValue({
      advice: adviceCiting(SESSION_ID),
      retrieved: [],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      latencyMs: 1,
      model: 'test',
    });

    const body = await (await ask(CAPTAIN_QUESTION)).json();

    expect(body.advice.refusal).toBeNull();
    expect(body.advice.recommended_changes).toHaveLength(1);
    expect(rows.at(-1)?.status).toBe('ok');
  });

  it('answers the example question the refusal screen tells the rider to ask', async () => {
    generateTuningAdvice.mockResolvedValue({
      advice: adviceCiting(PREVIOUS_SESSION_ID),
      retrieved: [],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      latencyMs: 1,
      model: 'test',
    });

    const body = await (await ask(SUGGESTED_QUESTION)).json();

    // The previous session is printed in this route's prompt and the model is
    // told to diagnose with it. Leaving it out of the accepted set turned a
    // correct citation into "I could not verify the historical session
    // evidence" - the product refusing the question it had just suggested.
    expect(body.advice.refusal).toBeNull();
    expect(body.advice.recommended_changes).toHaveLength(1);
    expect(rows.at(-1)?.status).toBe('ok');
  });

  it('STILL refuses a session id the rider does not own', async () => {
    generateTuningAdvice.mockResolvedValue({
      advice: adviceCiting(INVENTED_SESSION_ID),
      retrieved: [],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      latencyMs: 1,
      model: 'test',
    });

    const body = await (await ask(CAPTAIN_QUESTION)).json();

    expect(body.advice.refusal).toContain(UNVERIFIED_EVIDENCE_REFUSAL);
    expect(body.advice.recommended_changes).toEqual([]);
    expect(body.recommendation_id).toBeNull();
    expect(rows.at(-1)?.policy_violations).toContain('invalid_personal_evidence');
  });
});
