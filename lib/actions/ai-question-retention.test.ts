import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getRealUser: vi.fn() }));
vi.mock('@/lib/demo/mode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/demo/mode')>();
  const isDemoMode = vi.fn(async () => false);
  return {
    ...actual,
    isDemoMode,
    assertNotDemoMode: vi.fn(async () =>
      (await isDemoMode()) ? { ok: false, error: actual.DEMO_READ_ONLY_ERROR } : null,
    ),
  };
});
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/monitoring/report-error', () => ({ reportError: vi.fn() }));

import { revalidatePath } from 'next/cache';
import { getRealUser } from '@/lib/auth';
import { DEMO_READ_ONLY_ERROR, isDemoMode } from '@/lib/demo/mode';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  acknowledgeQuestionRetentionNotice,
  deleteAllRetainedQuestions,
  deleteRetainedQuestion,
  getRetainedQuestions,
  setQuestionRetention,
} from '@/lib/actions/ai-question-retention';
import {
  RETENTION_LOAD_FAILED_MESSAGE,
  RETENTION_OPT_OUT_DELETE_FAILED_MESSAGE,
  RETENTION_PROFILE_MISSING_MESSAGE,
} from '@/lib/ai-question-retention';

const USER_ID = '11111111-1111-4111-8111-111111111111';

type Result = { data?: unknown; error?: { message: string } | null; count?: number | null };

interface RecordedQuery {
  table: string;
  calls: [string, ...unknown[]][];
}

/**
 * A client whose queries record every builder call and resolve to the next
 * queued result for their table. What a test asserts is the recorded chain -
 * which table, which verb, which filters - because the filters ARE the
 * security property here: a preview update without `user_id` would clear
 * every rider's.
 */
function fakeClient(results: Record<string, Result[]>) {
  const queries: RecordedQuery[] = [];
  const from = vi.fn((table: string) => {
    const record: RecordedQuery = { table, calls: [] };
    queries.push(record);
    const result = () => results[table]?.shift() ?? { data: null, error: null };
    let settled: Result | null = null;
    const settle = () => (settled ??= result());
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'update', 'delete', 'eq', 'is', 'not', 'order', 'limit']) {
      query[method] = vi.fn((...args: unknown[]) => {
        record.calls.push([method, ...args]);
        return query;
      });
    }
    query.maybeSingle = vi.fn(async () => settle());
    query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(settle()).then(onFulfilled, onRejected);
    return query;
  });
  return { client: { from }, queries };
}

function useClients(user: Record<string, Result[]>, admin: Record<string, Result[]>) {
  const userClient = fakeClient(user);
  const adminClient = fakeClient(admin);
  vi.mocked(createClient).mockResolvedValue(userClient.client as never);
  vi.mocked(createAdminClient).mockReturnValue(adminClient.client as never);
  return { userQueries: userClient.queries, adminQueries: adminClient.queries };
}

function verbs(query: RecordedQuery) {
  return query.calls.map(([method]) => method);
}

const SEEN = '2026-09-01T00:00:00.000Z';

function storedProfile(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      ai_question_retention_notice_seen_at: SEEN,
      ai_question_retention_opted_out_at: null,
      ai_question_retention_opted_in_at: null,
      ai_question_retention_requires_opt_in: false,
      ...overrides,
    },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isDemoMode).mockResolvedValue(false);
  vi.mocked(getRealUser).mockResolvedValue({ id: USER_ID } as never);
});

describe('setQuestionRetention', () => {
  it('turning it off writes the flag first, then deletes every held row and nulls every preview of this rider', async () => {
    const { adminQueries, userQueries } = useClients(
      {},
      { profiles: [storedProfile(), { data: [{ id: USER_ID }], error: null }] },
    );

    const result = await setQuestionRetention('off');

    expect(result).toEqual({ ok: true, data: { keeping: false } });
    expect(adminQueries.map((query) => query.table)).toEqual(['profiles', 'profiles', 'ai_requests']);
    expect(userQueries.map((query) => query.table)).toEqual(['ai_request_text']);
    expect(revalidatePath).toHaveBeenCalled();

    const [, update, previewNull] = adminQueries;
    const [textDelete] = userQueries;
    expect(update.calls[0][0]).toBe('update');
    expect(update.calls[0][1]).toMatchObject({ ai_question_retention_opted_in_at: null });
    expect(typeof (update.calls[0][1] as Record<string, unknown>).ai_question_retention_opted_out_at).toBe('string');
    expect(update.calls).toContainEqual(['eq', 'id', USER_ID]);

    expect(verbs(textDelete)).toEqual(['delete', 'eq']);
    expect(textDelete.calls).toContainEqual(['eq', 'user_id', USER_ID]);

    expect(previewNull.calls[0]).toEqual(['update', { prompt_redacted_preview: null }]);
    expect(previewNull.calls).toContainEqual(['eq', 'user_id', USER_ID]);
  });

  it('reports a failed delete after opting out rather than claiming it worked, and leaves the screen that shows it mounted', async () => {
    useClients(
      { ai_request_text: [{ data: null, error: { message: 'boom' } }] },
      { profiles: [storedProfile(), { data: [{ id: USER_ID }], error: null }] },
    );

    expect(await setQuestionRetention('off')).toEqual({ ok: false, error: RETENTION_OPT_OUT_DELETE_FAILED_MESSAGE });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('retries the delete when the rider presses "Do not keep" while already off', async () => {
    const { userQueries, adminQueries } = useClients(
      {},
      {
        profiles: [
          storedProfile({ ai_question_retention_opted_out_at: SEEN }),
          { data: [{ id: USER_ID }], error: null },
        ],
      },
    );

    expect(await setQuestionRetention('off')).toEqual({ ok: true, data: { keeping: false } });
    expect(userQueries[0].calls).toEqual([['delete'], ['eq', 'user_id', USER_ID]]);
    expect(adminQueries.map((query) => query.table)).toContain('ai_requests');
  });

  it('turning it back on re-stamps opted_in_at, clears opted_out_at and deletes nothing', async () => {
    const { adminQueries } = useClients(
      {},
      {
        profiles: [
          storedProfile({ ai_question_retention_opted_out_at: SEEN }),
          { data: [{ id: USER_ID }], error: null },
        ],
      },
    );

    expect(await setQuestionRetention('keep')).toEqual({ ok: true, data: { keeping: true } });
    expect(adminQueries.map((query) => query.table)).toEqual(['profiles', 'profiles']);
    const written = adminQueries[1].calls[0][1] as Record<string, unknown>;
    expect(written.ai_question_retention_opted_out_at).toBeNull();
    expect(typeof written.ai_question_retention_opted_in_at).toBe('string');
    expect(written).not.toHaveProperty('ai_question_retention_notice_seen_at');
  });

  it('writes nothing when the rider is already keeping', async () => {
    const { adminQueries } = useClients({}, { profiles: [storedProfile()] });

    expect(await setQuestionRetention('keep')).toEqual({ ok: true, data: { keeping: true } });
    expect(adminQueries).toHaveLength(1);
    expect(verbs(adminQueries[0])).toEqual(['select', 'eq']);
  });

  it('refuses when the rider has no profile row', async () => {
    useClients({}, { profiles: [{ data: null, error: null }] });
    expect(await setQuestionRetention('off')).toEqual({ ok: false, error: RETENTION_PROFILE_MISSING_MESSAGE });
  });

  it('refuses in demo mode without touching a database', async () => {
    vi.mocked(isDemoMode).mockResolvedValue(true);
    const { adminQueries } = useClients({}, {});
    expect(await setQuestionRetention('off')).toEqual({ ok: false, error: DEMO_READ_ONLY_ERROR });
    expect(adminQueries).toHaveLength(0);
  });

  it('refuses a choice that is not one of the two', async () => {
    const { adminQueries } = useClients({}, {});
    expect((await setQuestionRetention('maybe' as never)).ok).toBe(false);
    expect(adminQueries).toHaveLength(0);
  });
});

describe('acknowledgeQuestionRetentionNotice', () => {
  it('stamps notice_seen_at only where it is still null', async () => {
    const { adminQueries } = useClients({}, { profiles: [{ data: null, error: null }] });

    expect(await acknowledgeQuestionRetentionNotice()).toEqual({ ok: true, data: undefined });
    const [update] = adminQueries;
    expect(update.calls).toContainEqual(['eq', 'id', USER_ID]);
    expect(update.calls).toContainEqual(['is', 'ai_question_retention_notice_seen_at', null]);
  });
});

describe('deleteRetainedQuestion', () => {
  it('deletes the text row through the rider client and nulls only that request preview of this rider', async () => {
    const { userQueries, adminQueries } = useClients({}, {});

    expect(await deleteRetainedQuestion('req-1')).toEqual({ ok: true, data: undefined });

    expect(userQueries).toHaveLength(1);
    expect(userQueries[0].table).toBe('ai_request_text');
    expect(userQueries[0].calls).toEqual([['delete'], ['eq', 'request_id', 'req-1']]);

    expect(adminQueries).toHaveLength(1);
    expect(adminQueries[0].table).toBe('ai_requests');
    expect(adminQueries[0].calls).toContainEqual(['eq', 'user_id', USER_ID]);
    expect(adminQueries[0].calls).toContainEqual(['eq', 'request_id', 'req-1']);
  });

  it('leaves the preview alone when the text delete failed', async () => {
    const { adminQueries } = useClients({ ai_request_text: [{ data: null, error: { message: 'boom' } }] }, {});
    expect((await deleteRetainedQuestion('req-1')).ok).toBe(false);
    expect(adminQueries).toHaveLength(0);
  });
});

describe('deleteAllRetainedQuestions', () => {
  it('deletes through the rider client and leaves the switch alone', async () => {
    const { userQueries, adminQueries } = useClients({}, {});

    expect(await deleteAllRetainedQuestions()).toEqual({ ok: true, data: undefined });
    expect(userQueries[0].calls).toEqual([['delete'], ['eq', 'user_id', USER_ID]]);
    expect(adminQueries.map((query) => query.table)).toEqual(['ai_requests']);
  });
});

describe('getRetainedQuestions', () => {
  it('reads the rider rows newest first and describes each', async () => {
    const { userQueries } = useClients(
      {
        ai_request_text: [
          {
            data: [
              {
                request_id: 'req-1',
                route: 'tuning_advice',
                submitted: { question: 'Front pushes.' },
                created_at: '2026-09-20T00:00:00Z',
                retain_until: '2026-12-19T00:00:00Z',
              },
            ],
            error: null,
            count: 1,
          },
        ],
      },
      {},
    );

    expect(await getRetainedQuestions()).toEqual({
      ok: true,
      data: {
        questions: [
          {
            requestId: 'req-1',
            route: 'tuning_advice',
            text: 'Front pushes.',
            createdAt: '2026-09-20T00:00:00Z',
            retainUntil: '2026-12-19T00:00:00Z',
          },
        ],
        total: 1,
      },
    });
    expect(userQueries[0].calls).toContainEqual(['order', 'created_at', { ascending: false }]);
  });

  it('reports every held row in the total when the list is cut', async () => {
    const { userQueries } = useClients(
      {
        ai_request_text: [
          {
            data: [
              {
                request_id: 'req-1',
                route: 'tuning_advice',
                submitted: { question: 'Front pushes.' },
                created_at: '2026-09-20T00:00:00Z',
                retain_until: '2026-12-19T00:00:00Z',
              },
            ],
            error: null,
            count: 250,
          },
        ],
      },
      {},
    );

    const result = await getRetainedQuestions();
    expect(result.ok && result.data.total).toBe(250);
    expect(result.ok && result.data.questions).toHaveLength(1);
    expect(userQueries[0].calls).toContainEqual([
      'select',
      'request_id, route, submitted, created_at, retain_until',
      { count: 'exact' },
    ]);
  });

  it('reports a failed read as a failure, never as holding nothing', async () => {
    useClients({ ai_request_text: [{ data: null, error: { message: 'boom' } }] }, {});
    expect(await getRetainedQuestions()).toEqual({ ok: false, error: RETENTION_LOAD_FAILED_MESSAGE });
  });
});
