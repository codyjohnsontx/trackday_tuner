import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAuthenticatedUser,
  getUserProfile,
  createClient,
  createAdminClient,
  generateTuningAdvice,
  loadRaceEngineerContext,
} = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getUserProfile: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  generateTuningAdvice: vi.fn(),
  loadRaceEngineerContext: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser,
}));

vi.mock('@/lib/actions/vehicles', () => ({
  getUserProfile,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient,
}));

vi.mock('@/lib/env.server', () => ({
  getAiRateLimitPerHour: vi.fn(() => 20),
  getAiRateLimitPerMinute: vi.fn(() => 3),
  getAiRequestFingerprintSecret: vi.fn(() => 'test-secret'),
}));

vi.mock('@/lib/rag/advice', () => ({
  generateTuningAdvice,
  UpstreamTimeoutError: class UpstreamTimeoutError extends Error {},
}));

vi.mock('@/lib/rag/race-engineer-context', () => ({
  loadRaceEngineerContext,
  createRecommendationSnapshot: vi.fn(() => ({})),
}));

import { POST } from '@/app/api/ai/tuning-advice/route';
import { buildPromptFingerprint } from '@/lib/ai-observability';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const VEHICLE_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_SESSION_ID = '44444444-4444-4444-4444-444444444444';

interface AiRequestRow {
  request_id: string;
  user_id: string;
  session_id: string | null;
  prompt_fingerprint: string;
  status: string;
  created_at: string;
  refusal_reason?: string | null;
  policy_result?: string | null;
  policy_violations?: string[] | null;
  classifier_stage?: string | null;
}

function createServerClient() {
  const sessionsQuery = {
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => ({
      data: [],
      error: null,
    })),
    single: vi.fn(async () => ({
      data: {
        id: SESSION_ID,
        user_id: USER_ID,
        vehicle_id: VEHICLE_ID,
        track_id: null,
        track_name: 'Test Track',
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
          front: { preload: '', compression: '', rebound: '', direction: 'in' },
          rear: { preload: '', compression: '', rebound: '', direction: 'in' },
        },
        alignment: null,
        enabled_modules: null,
        extra_modules: null,
        notes: 'Front pushes on entry.',
        created_at: '2026-04-25T10:00:00.000Z',
        updated_at: '2026-04-25T10:00:00.000Z',
      },
      error: null,
    })),
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
    from: vi.fn((table) => {
      if (table === 'sessions') {
        return { select: vi.fn(() => sessionsQuery) };
      }
      if (table === 'vehicles') return { select: vi.fn(() => vehiclesQuery) };
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function createAiRequestsQuery(
  rows: AiRequestRow[],
  { head = false, count = false }: { head?: boolean; count?: boolean } = {},
) {
  const filters: Array<(row: AiRequestRow) => boolean> = [];
  let orderBy: keyof AiRequestRow | null = null;
  let ascending = true;
  let rowLimit: number | null = null;

  const builder = {
    eq(field: keyof AiRequestRow, value: string | null) {
      filters.push((row) => row[field] === value);
      return builder;
    },
    neq(field: keyof AiRequestRow, value: string | null) {
      filters.push((row) => row[field] !== value);
      return builder;
    },
    in(field: keyof AiRequestRow, values: Array<string | null>) {
      filters.push((row) => values.includes((row[field] as string | null | undefined) ?? null));
      return builder;
    },
    gte(field: keyof AiRequestRow, value: string) {
      filters.push((row) => String((row[field] as string | null | undefined) ?? '') >= value);
      return builder;
    },
    order(field: keyof AiRequestRow, options: { ascending?: boolean } = {}) {
      orderBy = field;
      ascending = options.ascending ?? true;
      return builder;
    },
    limit(value: number) {
      rowLimit = value;
      return builder;
    },
    then(
      resolve: (value: { data: AiRequestRow[] | null; count: number | null; error: null }) => void,
      reject: (reason?: unknown) => void,
    ) {
      try {
        let resultRows = rows.filter((row) => filters.every((predicate) => predicate(row)));
        if (orderBy) {
          const sortKey = orderBy;
          resultRows = [...resultRows].sort((a, b) => {
            if (a[sortKey] === b[sortKey]) return 0;
            return String(a[sortKey] ?? '') < String(b[sortKey] ?? '')
              ? (ascending ? -1 : 1)
              : (ascending ? 1 : -1);
          });
        }
        if (typeof rowLimit === 'number') {
          resultRows = resultRows.slice(0, rowLimit);
        }
        resolve({
          data: head ? null : resultRows,
          count: count ? resultRows.length : null,
          error: null,
        });
      } catch (error) {
        reject(error);
      }
    },
  };

  return builder;
}

function createAdminClientMock(aiRequests: AiRequestRow[]) {
  return {
    from: vi.fn((table) => {
      if (table !== 'ai_requests') {
        throw new Error(`Unexpected admin table: ${table}`);
      }

      return {
        insert: vi.fn(async (row: Omit<AiRequestRow, 'created_at'>) => {
          aiRequests.push({
            ...row,
            created_at: new Date().toISOString(),
          });
          return { error: null };
        }),
        update: vi.fn((patch) => ({
          eq: vi.fn(async (_field, value) => {
            for (const row of aiRequests) {
              if (row.request_id === value) Object.assign(row, patch);
            }
            return { error: null };
          }),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
        select: vi.fn((_fields, options = {}) =>
          createAiRequestsQuery(aiRequests, {
            head: Boolean(options.head),
            count: options.count === 'exact',
          }),
        ),
      };
    }),
  };
}

function buildRequestBody(question: string) {
  return {
    vehicle_id: VEHICLE_ID,
    session_id: SESSION_ID,
    question,
  };
}

function fingerprintFor(question: string): string {
  return buildPromptFingerprint({
    question,
    symptoms: [],
    changeIntent: null,
    secret: 'test-secret',
  });
}

describe('POST /api/ai/tuning-advice duplicate handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUser.mockResolvedValue({ id: USER_ID });
    getUserProfile.mockResolvedValue({ id: USER_ID, tier: 'pro' });
    createClient.mockResolvedValue(createServerClient());
    loadRaceEngineerContext.mockResolvedValue(null);
    generateTuningAdvice.mockResolvedValue(null);
  });

  it('returns a handled duplicate refusal and skips model generation', async () => {
    const question = 'Front pushes on entry after I raised pressure 1 psi. What next?';
    const aiRequests: AiRequestRow[] = [
      {
        request_id: 'existing-request',
        user_id: USER_ID,
        session_id: SESSION_ID,
        prompt_fingerprint: fingerprintFor(question),
        status: 'ok',
        created_at: new Date().toISOString(),
      },
    ];
    createAdminClient.mockReturnValue(createAdminClientMock(aiRequests));

    const response = await POST(
      new Request('http://127.0.0.1:3000/api/ai/tuning-advice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildRequestBody(question)),
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.recommendation_id).toBeNull();
    expect(body.advice.refusal).toContain('An identical Race Engineer request was handled recently');
    expect(body.advice.recommended_changes).toEqual([]);
    expect(generateTuningAdvice).not.toHaveBeenCalled();
  });

  it('does not dedupe across different sessions', async () => {
    const question = 'Give me a simple recipe for oatmeal cookies.';
    const aiRequests: AiRequestRow[] = [
      {
        request_id: 'existing-request',
        user_id: USER_ID,
        session_id: OTHER_SESSION_ID,
        prompt_fingerprint: fingerprintFor(question),
        status: 'ok',
        created_at: new Date().toISOString(),
      },
    ];
    createAdminClient.mockReturnValue(createAdminClientMock(aiRequests));

    const response = await POST(
      new Request('http://127.0.0.1:3000/api/ai/tuning-advice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildRequestBody(question)),
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.advice.refusal).toContain('outside track setup scope');
    expect(generateTuningAdvice).not.toHaveBeenCalled();
  });

  it('does not dedupe outside the recent-request window', async () => {
    const question = 'Give me a simple recipe for oatmeal cookies.';
    const aiRequests: AiRequestRow[] = [
      {
        request_id: 'existing-request',
        user_id: USER_ID,
        session_id: SESSION_ID,
        prompt_fingerprint: fingerprintFor(question),
        status: 'ok',
        created_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      },
    ];
    createAdminClient.mockReturnValue(createAdminClientMock(aiRequests));

    const response = await POST(
      new Request('http://127.0.0.1:3000/api/ai/tuning-advice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildRequestBody(question)),
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.advice.refusal).toContain('outside track setup scope');
    expect(generateTuningAdvice).not.toHaveBeenCalled();
  });
});
