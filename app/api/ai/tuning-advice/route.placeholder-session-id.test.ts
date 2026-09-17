import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A PLACEHOLDER IS NOT A REFERENCE, AND IT MUST NOT COST THE RIDER THE ANSWER.
 *
 * `mc-gearing-slow-corner` in the eval's golden set asks about dropping out of
 * the powerband exiting a second-gear corner. On the 2026-09-08 recording the
 * model answered it correctly - `rear_sprocket / decrease / 1 tooth`, cited
 * `docs/knowledge-base/drivetrain/gearing-basics.md`, and quoted the rider's own
 * session notes back - and then wrote the four-character STRING "null" where the
 * session reference belongs. `evaluateAdvicePolicy` read that as a session id it
 * could not verify and force-refused the WHOLE response, so the rider was told
 * only that the historical session evidence could not be verified.
 *
 * The response below is that recording verbatim (commit 5524a4c, completions
 * tape key 5ea2f97b7872510ff6f6d355f4ca5c4d).
 *
 * THE MODEL IS THE ONLY THING MOCKED BELOW THE ROUTE. `lib/rag/advice.ts` is
 * real, so `parseAdviceResponse` runs on the raw JSON exactly as it does in
 * production, and `evaluateAdvicePolicy` then reads what the parser produced -
 * which is the whole point, because the fix is in the parser and a test that
 * mocks `generateTuningAdvice` would step straight over it. The transport is
 * stubbed at `fetch`, the same seam `scripts/eval/openai-tape.mjs` uses.
 */

const {
  getRealUser,
  getUserProfile,
  createClient,
  createAdminClient,
  loadRaceEngineerContext,
  retrieveRelevantChunks,
  embedQuery,
} = vi.hoisted(() => ({
  getRealUser: vi.fn(),
  getUserProfile: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  loadRaceEngineerContext: vi.fn(),
  retrieveRelevantChunks: vi.fn(),
  embedQuery: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getRealUser }));
vi.mock('@/lib/actions/vehicles', () => ({ getUserProfile }));
vi.mock('@/lib/supabase/server', () => ({ createClient }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
vi.mock('@/lib/env.server', () => ({
  getAiRateLimitPerHour: vi.fn(() => 20),
  getAiRateLimitPerMinute: vi.fn(() => 3),
  getAiRequestFingerprintSecret: vi.fn(() => 'test-secret'),
  getAiModel: vi.fn(() => 'gpt-4o-mini'),
  getOpenAIApiKey: vi.fn(() => 'test-key'),
  getAiEmbeddingModel: vi.fn(() => 'text-embedding-3-small'),
}));
// Retrieval is not what this is about, but `filterCitationsToRetrievedSources`
// strips a citation whose source was not retrieved, and a stripped citation
// would refuse the response for being ungrounded instead - a different failure
// wearing the same refusal. So the gearing chunk the model actually cited is
// handed back, and no embedding call is made.
vi.mock('@/lib/rag/retriever', () => ({ retrieveRelevantChunks }));
vi.mock('@/lib/rag/embed', () => ({ embedQuery }));
vi.mock('@/lib/rag/race-engineer-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rag/race-engineer-context')>()),
  loadRaceEngineerContext,
  createRecommendationSnapshot: vi.fn(() => ({})),
}));

import { POST } from '@/app/api/ai/tuning-advice/route';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const VEHICLE_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const FABRICATED_SESSION_ID = '99999999-9999-4999-8999-999999999999';

const GEARING_QUESTION =
  'I keep dropping out of the powerband exiting a second-gear corner. What gearing change should I try?';

const UNVERIFIED_EVIDENCE_REFUSAL =
  'I could not verify the historical session evidence referenced in that response';

const SESSION_ROW = {
  id: SESSION_ID,
  user_id: USER_ID,
  vehicle_id: VEHICLE_ID,
  track_id: null,
  track_name: 'NCM Motorsports Park',
  date: '2026-07-14',
  start_time: '11:45:00',
  session_number: 3,
  conditions: 'sunny',
  tires: {
    front: { brand: 'Pirelli', compound: 'SC2', pressure: '31.0 psi' },
    rear: { brand: 'Pirelli', compound: 'SC1', pressure: '24.5 psi' },
    condition: 'scrubbed',
  },
  suspension: {
    front: { preload: '3 turns', compression: '8 clicks', rebound: '10 clicks', direction: 'in' },
    rear: { preload: '5 clicks', compression: '9 clicks', rebound: '11 clicks', direction: 'in' },
  },
  alignment: null,
  enabled_modules: null,
  extra_modules: null,
  notes: 'Falls out of the powerband on the drive out of the slow left. Second gear is too tall there.',
  created_at: '2026-07-14T11:45:00.000Z',
  updated_at: '2026-07-14T11:45:00.000Z',
};

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

function serverClient() {
  const sessions = {
    eq: vi.fn(() => sessions),
    neq: vi.fn(() => sessions),
    or: vi.fn(() => sessions),
    lt: vi.fn(() => sessions),
    lte: vi.fn(() => sessions),
    order: vi.fn(() => sessions),
    limit: vi.fn(async () => ({ data: [SESSION_ROW], error: null })),
    single: vi.fn(async () => ({ data: SESSION_ROW, error: null })),
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

/** The 2026-09-08 recording, verbatim apart from `source_session_id`. */
function recordedGearingAnswer(sourceSessionId: unknown) {
  return {
    summary:
      'To address the issue of dropping out of the powerband exiting the second-gear corner, I recommend shortening the gearing by changing the rear sprocket. This should help keep the RPMs within the powerband during your exit.',
    recommended_changes: [
      {
        component: 'rear_sprocket',
        direction: 'decrease',
        magnitude: '1 tooth',
        reason: 'Shortening the gearing will help maintain RPMs in the powerband exiting the corner.',
      },
    ],
    tradeoffs: [],
    confidence: 'high',
    safety_notes: [],
    citations: [
      {
        source: 'docs/knowledge-base/drivetrain/gearing-basics.md',
        snippet: 'Second gear corner that drops RPM below the powerband: shorten gearing.',
      },
    ],
    prediction: {
      expected_effect: 'Improved acceleration out of the corner and better powerband engagement.',
      day_trend: 'Monitor tire pressures and wear as the day progresses.',
      watch_items: ['hot pressures', 'tire wear', 'corner exit performance'],
    },
    personal_evidence: [
      {
        label: 'Session notes',
        detail:
          'Falls out of the powerband on the drive out of the slow left. Second gear is too tall there.',
        source_session_id: sourceSessionId,
      },
    ],
    data_used: {
      manual: true,
      weather: false,
      history: false,
      feedback: false,
      lap_data: false,
      telemetry: false,
    },
    refusal: null,
  };
}

/**
 * The OpenAI client is cached in `lib/rag/advice.ts` and captures `fetch` when
 * it is built, so re-stubbing between tests leaves the second case talking to
 * the first case's stub. The stub is therefore installed ONCE and reads what to
 * answer with from here.
 */
let modelSessionReference: unknown = null;

function stubModel(sourceSessionId: unknown) {
  modelSessionReference = sourceSessionId;
}

function modelResponse() {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1789108694,
      model: 'gpt-4o-mini-2024-07-18',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: JSON.stringify(recordedGearingAnswer(modelSessionReference)),
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1200, completion_tokens: 220, total_tokens: 1420 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

async function ask() {
  return POST(
    new Request('http://localhost/api/ai/tuning-advice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: SESSION_ID,
        vehicle_id: VEHICLE_ID,
        question: GEARING_QUESTION,
        change_intent: 'more_exit_grip',
        temperature_c: 28,
      }),
    }),
  );
}

describe('a placeholder session reference does not cost the rider the answer', () => {
  let rows: Row[];

  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn(async () => modelResponse()));
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    getRealUser.mockResolvedValue({ id: USER_ID });
    getUserProfile.mockResolvedValue({ tier: 'pro', beta_access_expires_at: null });
    createClient.mockResolvedValue(serverClient());
    createAdminClient.mockReturnValue(adminClient(rows));
    embedQuery.mockResolvedValue([0.1, 0.2, 0.3]);
    retrieveRelevantChunks.mockResolvedValue([
      {
        score: 0.9,
        chunk: {
          id: 'gearing-basics-1',
          source: 'docs/knowledge-base/drivetrain/gearing-basics.md',
          title: 'Gearing basics',
          text: 'Second gear corner that drops RPM below the powerband: shorten gearing.',
          vehicle_type: 'motorcycle',
          tags: ['gearing'],
        },
      },
    ]);
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

  it('serves the gearing answer when the model writes the string "null" as the reference', async () => {
    stubModel('null');

    const body = await (await ask()).json();

    expect(body.advice.refusal).toBeNull();
    expect(body.advice.recommended_changes).toHaveLength(1);
    expect(body.advice.recommended_changes[0].component).toBe('rear_sprocket');
    // The evidence itself survives and reads as what it is: an observation with
    // no session behind it.
    expect(body.advice.personal_evidence[0].source_session_id).toBeNull();
    expect(rows.at(-1)?.policy_violations ?? []).not.toContain('invalid_personal_evidence');
  });

  it('still refuses a reference the prompt never printed', async () => {
    stubModel(FABRICATED_SESSION_ID);

    const body = await (await ask()).json();

    expect(body.advice.refusal).toContain(UNVERIFIED_EVIDENCE_REFUSAL);
    expect(body.advice.recommended_changes).toHaveLength(0);
    expect(rows.at(-1)?.policy_violations).toContain('invalid_personal_evidence');
  });
});
