/**
 * A number stored where the prompt expected text, from the rider's request to
 * the response they get back.
 *
 * `sessions.suspension` and `sessions.tires` are shape-unconstrained `jsonb`
 * that `createSession` inserts verbatim, so a leaf the TypeScript type calls a
 * string can hold a JSON number. `formatValue` in `lib/rag/prompt.ts` called
 * `.trim()` on it unguarded, which threw `TypeError: value.trim is not a
 * function` inside the route's error boundary and answered the rider with the
 * shaped 500 that boundary exists to produce - a rider with a valid saved
 * session and a legitimate question got an error instead of advice, with no way
 * to tell what about their session was wrong.
 *
 * The prompt builder, `lib/rag/advice.ts`, the domain guard and the policy are
 * all REAL here; only Supabase, the embedding call and the model call are
 * stubbed. That matters, because the throw is raised by the prompt builder on
 * the session the ROUTE loaded - a harness that stubs `generateTuningAdvice`
 * never builds that prompt and cannot see this at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getRealUser,
  getUserProfile,
  createClient,
  createAdminClient,
  loadRaceEngineerContext,
  embedQuery,
  retrieveRelevantChunks,
  chatCompletionsCreate,
} = vi.hoisted(() => ({
  getRealUser: vi.fn(),
  getUserProfile: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  loadRaceEngineerContext: vi.fn(),
  embedQuery: vi.fn(),
  retrieveRelevantChunks: vi.fn(),
  chatCompletionsCreate: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getRealUser }));
vi.mock('@/lib/actions/vehicles', () => ({ getUserProfile }));
vi.mock('@/lib/supabase/server', () => ({ createClient }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
vi.mock('@/lib/env.server', () => ({
  getAiRateLimitPerHour: vi.fn(() => 20),
  getAiRateLimitPerMinute: vi.fn(() => 3),
  getAiRequestFingerprintSecret: vi.fn(() => 'test-secret'),
  getAiModel: vi.fn(() => 'test-model'),
  getOpenAIApiKey: vi.fn(() => 'test-key'),
}));
vi.mock('@/lib/rag/embed', () => ({ embedQuery }));
vi.mock('@/lib/rag/retriever', () => ({ retrieveRelevantChunks }));
vi.mock('openai', () => {
  class APIConnectionTimeoutError extends Error {}
  class APIUserAbortError extends Error {}
  class OpenAI {
    chat = { completions: { create: chatCompletionsCreate } };
  }
  return { default: OpenAI, OpenAI, APIConnectionTimeoutError, APIUserAbortError };
});
vi.mock('@/lib/rag/race-engineer-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rag/race-engineer-context')>()),
  loadRaceEngineerContext,
  createRecommendationSnapshot: vi.fn(() => ({})),
}));

import { POST } from '@/app/api/ai/tuning-advice/route';
import type { KnowledgeChunk } from '@/lib/rag/types';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const VEHICLE_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const SOURCE = 'docs/knowledge-base/tires/pressure-basics.md';

const QUESTION = 'Front pushes on entry after I raised pressure 1 psi. What next?';

/**
 * The rider's saved session, with `suspension.front.preload` holding the JSON
 * number 5. The TypeScript type says `string`; the column says `jsonb`, and the
 * column is what the row actually obeys - hence the cast.
 */
function sessionRow() {
  return {
    id: SESSION_ID,
    user_id: USER_ID,
    vehicle_id: VEHICLE_ID,
    track_id: null,
    track_name: 'Test Track',
    layout_id: null,
    layout_name: null,
    date: '2026-04-25',
    start_time: '10:00:00',
    session_number: 1,
    conditions: 'sunny',
    tires: {
      front: { brand: '', compound: '', pressure: '30 psi' },
      rear: { brand: '', compound: '', pressure: '28 psi' },
      condition: 'used',
    },
    suspension: {
      front: { preload: 5, compression: '', rebound: '', direction: 'in' },
      rear: { preload: '', compression: '', rebound: '', direction: 'in' },
    },
    alignment: null,
    enabled_modules: null,
    extra_modules: null,
    notes: 'Front pushes on entry.',
    created_at: '2026-04-25T10:00:00.000Z',
    updated_at: '2026-04-25T10:00:00.000Z',
  };
}

function createServerClient() {
  const sessionsQuery = {
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => ({ data: [], error: null })),
    single: vi.fn(async () => ({ data: sessionRow(), error: null })),
  };

  const vehiclesQuery = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(async () => ({
      data: {
        id: VEHICLE_ID,
        user_id: USER_ID,
        nickname: 'Bike',
        type: 'motorcycle',
        year: null,
        make: null,
        model: null,
        photo_url: null,
        created_at: '2026-04-25T10:00:00.000Z',
        updated_at: '2026-04-25T10:00:00.000Z',
      },
      error: null,
    })),
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'sessions') return { select: vi.fn(() => sessionsQuery) };
      if (table === 'vehicles') return { select: vi.fn(() => vehiclesQuery) };
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function createAdminClientMock() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'ai_recommendations') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: 'rec-test' }, error: null })),
            })),
          })),
        };
      }
      if (table !== 'ai_requests') throw new Error(`Unexpected admin table: ${table}`);
      const empty = {
        eq: () => empty,
        neq: () => empty,
        in: () => empty,
        gte: () => empty,
        order: () => empty,
        limit: () => empty,
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: [], count: 0, error: null }),
      };
      return {
        insert: vi.fn(async () => ({ error: null })),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
        delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
        select: vi.fn(() => empty),
      };
    }),
  };
}

function chunk(): KnowledgeChunk {
  return {
    id: `${SOURCE}#01`,
    source: SOURCE,
    heading: 'Common symptoms',
    vehicle_type: 'both',
    topic: 'tires',
    summary: null,
    text: 'Front pushing on entry after a pressure increase: drop 0.5 psi.',
    embedding: [],
  };
}

const MODEL_ADVICE = {
  summary: 'Drop front cold pressure half a psi and re-run the session.',
  recommended_changes: [
    {
      component: 'front_tire_pressure',
      direction: 'decrease',
      magnitude: '0.5 psi',
      reason: 'The front is pushing on entry after the pressure went up.',
    },
  ],
  tradeoffs: [],
  confidence: 'medium',
  safety_notes: [],
  citations: [{ source: SOURCE, snippet: 'Front pushing on entry: drop 0.5 psi.' }],
  prediction: {
    expected_effect: 'More front grip on entry.',
    day_trend: 'Track temperature will keep climbing.',
    watch_items: ['hot pressures'],
  },
  personal_evidence: [],
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

function request() {
  return new Request('http://localhost/api/ai/tuning-advice', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      vehicle_id: VEHICLE_ID,
      session_id: SESSION_ID,
      question: QUESTION,
    }),
  });
}

describe('POST /api/ai/tuning-advice with a non-string field in the session jsonb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRealUser.mockResolvedValue({ id: USER_ID });
    getUserProfile.mockResolvedValue({ id: USER_ID, tier: 'pro' });
    createClient.mockResolvedValue(createServerClient());
    createAdminClient.mockReturnValue(createAdminClientMock());
    loadRaceEngineerContext.mockResolvedValue({
      similarSessions: [],
      sessionEnvironment: null,
      recentFeedback: [],
      recentRecommendations: [],
      memory: null,
      telemetrySummary: null,
      dayTrend: 'No trend yet.',
      dataUsed: {
        manual: true,
        weather: false,
        history: false,
        feedback: false,
        lap_data: false,
        telemetry: false,
      },
    });
    embedQuery.mockResolvedValue([0.1, 0.2, 0.3]);
    retrieveRelevantChunks.mockResolvedValue([{ chunk: chunk(), score: 0.9 }]);
    chatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(MODEL_ADVICE) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      model: 'test-model',
    });
  });

  it('answers the rider instead of failing the request', async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.advice.refusal).toBeNull();
    expect(chatCompletionsCreate).toHaveBeenCalledTimes(1);
  });

  it('prints the stored number in the prompt rather than dropping the field', async () => {
    await POST(request());

    const [{ messages }] = chatCompletionsCreate.mock.calls[0] as [
      { messages: Array<{ role: string; content: string }> },
    ];
    const userPrompt = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userPrompt).toContain('suspension.front: preload=5 ');
  });
});
