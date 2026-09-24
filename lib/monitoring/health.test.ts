import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const { createAdminClient, loadKnowledgeIndex, isKnowledgeIndexLoaded } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  loadKnowledgeIndex: vi.fn(),
  isKnowledgeIndexLoaded: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
// Mocked wholesale rather than spied: the real module imports `server-only`,
// which does not resolve in the node-environment unit suite.
vi.mock('@/lib/rag/retriever', () => ({ loadKnowledgeIndex, isKnowledgeIndexLoaded }));

import {
  AI_TEXT_RETENTION_GRACE_MS,
  HEALTH_CHECK_TIMEOUT_MS,
  checkAiTextRetention,
  checkRagIndex,
  checkSupabase,
} from '@/lib/monitoring/health';

/**
 * A stub PostgREST, driven through the real `@supabase/supabase-js` client so
 * the check meets the same request builder and response parser production does.
 *
 * The one rule it enforces is the one that matters here: HTTP forbids a body on
 * a response to HEAD, and PostgREST sends none, so an error payload only
 * reaches the client when the request is a GET.
 */
function stubPostgrest(status: number, payload: unknown) {
  const methods: string[] = [];
  const fetchStub = (async (_input: unknown, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    methods.push(method);
    return new Response(method === 'HEAD' ? null : JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }) as unknown as typeof fetch;

  createAdminClient.mockReturnValue(
    createClient('http://postgrest.stub', 'service-role-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchStub },
    }),
  );
  return methods;
}

describe('checkSupabase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('passes when PostgREST answers the query', async () => {
    stubPostgrest(200, [{ id: '00000000-0000-0000-0000-000000000000' }]);

    const check = await checkSupabase();

    expect(check.status).toBe('ok');
    expect(check.detail).toBeUndefined();
  });

  // The R3-shaped hole: `PGRST205` is what PostgREST answers when the table is
  // gone or the schema cache is stale after a migration - the same family as the
  // `PGRST202` incident in CLAUDE.md. Every rider-facing page is broken and the
  // health check has to say so rather than report a healthy deployment.
  it('fails when PostgREST cannot find the table', async () => {
    stubPostgrest(404, {
      code: 'PGRST205',
      details: null,
      hint: null,
      message: "Could not find the table 'public.profiles' in the schema cache",
    });

    const check = await checkSupabase();

    expect(check.status).toBe('fail');
    expect(check.detail).toBe('SupabaseError:PGRST205');
  });

  it('names the code when the Data API grant is missing', async () => {
    stubPostgrest(403, {
      code: '42501',
      details: null,
      hint: null,
      message: 'permission denied for table profiles',
    });

    const check = await checkSupabase();

    expect(check.status).toBe('fail');
    expect(check.detail).toBe('SupabaseError:42501');
  });

  // The discriminator that makes the code label mean something: an unreachable
  // project carries no code, so it must not be labelled as a rejection.
  it('names a transport failure rather than printing a bare colon', async () => {
    const fetchStub = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    createAdminClient.mockReturnValue(
      createClient('http://postgrest.stub', 'service-role-key', {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: fetchStub },
      }),
    );

    const check = await checkSupabase();

    expect(check.status).toBe('fail');
    expect(check.detail).toBe('SupabaseUnreachableError');
  });

  it('keeps the PostgREST message out of the check it returns', async () => {
    stubPostgrest(403, {
      code: '42501',
      details: null,
      hint: null,
      message: 'permission denied for table profiles',
    });

    const check = await checkSupabase();

    expect(JSON.stringify(check)).not.toContain('permission denied');
    expect(console.error).toHaveBeenCalled();
  });
});

/**
 * A stub PostgREST that also answers the exact count, which PostgREST reports in
 * `Content-Range` (`0-0/3`, or a star over 0 for none) and `postgrest-js` parses into
 * `count`. `contentRange: null` sends no header, so the client reads no count.
 * Answers are per table; a table not named answers an empty, zero count.
 */
interface CountingAnswer {
  status: number;
  payload: unknown;
  contentRange: string | null;
}

const NONE_OVERDUE: CountingAnswer = { status: 200, payload: [], contentRange: '*/0' };

function stubCountingPostgrest(byTable: Record<string, CountingAnswer>) {
  const requests: { method: string; url: string; prefer: string | null }[] = [];
  const fetchStub = (async (input: unknown, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    requests.push({ method, url: String(input), prefer: new Headers(init?.headers).get('prefer') });
    const table = new URL(String(input)).pathname.replace('/rest/v1/', '');
    const { status, payload, contentRange } = byTable[table] ?? NONE_OVERDUE;
    const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
    if (contentRange !== null) headers['content-range'] = contentRange;
    return new Response(method === 'HEAD' ? null : JSON.stringify(payload), { status, headers });
  }) as unknown as typeof fetch;

  createAdminClient.mockReturnValue(
    createClient('http://postgrest.stub', 'service-role-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchStub },
    }),
  );
  return requests;
}

function requestTo(requests: { method: string; url: string; prefer: string | null }[], table: string) {
  const found = requests.find((request) => new URL(request.url).pathname === `/rest/v1/${table}`);
  if (!found) throw new Error(`No request to ${table} in ${JSON.stringify(requests)}`);
  return { ...found, url: new URL(found.url) };
}

describe('checkAiTextRetention', () => {
  const now = new Date('2026-12-01T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('passes when no retained text is overdue, asking only about rows 36 hours past retain_until', async () => {
    const requests = stubCountingPostgrest({});

    const check = await checkAiTextRetention(now);

    expect(check.status).toBe('ok');
    expect(check.detail).toBe('0 overdue');
    const text = requestTo(requests, 'ai_request_text');
    expect(text.method).toBe('GET');
    expect(text.prefer).toContain('count=exact');
    const cutoff = new Date(now.getTime() - AI_TEXT_RETENTION_GRACE_MS).toISOString();
    expect(text.url.searchParams.get('retain_until')).toBe(`lt.${cutoff}`);
    expect(cutoff).toBe('2026-11-30T00:00:00.000Z');
  });

  it('asks only about previews still held 90 days and 36 hours after their request', async () => {
    const requests = stubCountingPostgrest({});

    const check = await checkAiTextRetention(now);

    expect(check.status).toBe('ok');
    const previews = requestTo(requests, 'ai_requests');
    expect(previews.method).toBe('GET');
    expect(previews.prefer).toContain('count=exact');
    expect(previews.url.searchParams.get('prompt_redacted_preview')).toBe('not.is.null');
    expect(previews.url.searchParams.get('created_at')).toBe('lt.2026-09-01T00:00:00.000Z');
  });

  // The purge not running is the failure this exists to report. The count is a
  // number of rows, never their text, so it may be named in the public body.
  it('fails naming the count when rows have outlived the grace', async () => {
    stubCountingPostgrest({
      ai_request_text: { status: 200, payload: [{ request_id: 'req-1' }], contentRange: '0-0/3' },
    });

    const check = await checkAiTextRetention(now);

    expect(check.status).toBe('fail');
    expect(check.detail).toBe('OverdueRetainedTextError:3');
  });

  // Nothing writes ai_request_text yet, so until it does the previews are the
  // only rows that show whether the job runs at all.
  it('fails naming the count when previews have outlived the grace', async () => {
    stubCountingPostgrest({
      ai_requests: {
        status: 200,
        payload: [{ request_id: 'req-1' }],
        contentRange: '0-0/5',
      },
    });

    const check = await checkAiTextRetention(now);

    expect(check.status).toBe('fail');
    expect(check.detail).toBe('OverduePreviewError:5');
    expect(JSON.stringify(check)).not.toContain('req-1');
  });

  it('fails with the PostgREST code when the previews cannot be read', async () => {
    stubCountingPostgrest({
      ai_requests: {
        status: 403,
        payload: { code: '42501', details: null, hint: null, message: 'permission denied for table ai_requests' },
        contentRange: null,
      },
    });

    const check = await checkAiTextRetention(now);

    expect(check.status).toBe('fail');
    expect(check.detail).toBe('SupabaseError:42501');
    expect(JSON.stringify(check)).not.toContain('permission denied');
  });

  // A project that never got 20260924001700 holds no text, but the code expects
  // a table that is not there, and saying "healthy" would hide that.
  it('fails with the PostgREST code when the table is missing', async () => {
    stubCountingPostgrest({
      ai_request_text: {
        status: 404,
        payload: {
          code: 'PGRST205',
          details: null,
          hint: null,
          message: "Could not find the table 'public.ai_request_text' in the schema cache",
        },
        contentRange: null,
      },
    });

    const check = await checkAiTextRetention(now);

    expect(check.status).toBe('fail');
    expect(check.detail).toBe('SupabaseError:PGRST205');
    expect(JSON.stringify(check)).not.toContain('schema cache');
  });

  // An answer with no count measured nothing, so it cannot say the promise holds.
  it('fails when the answer carries no count', async () => {
    stubCountingPostgrest({ ai_request_text: { status: 200, payload: [], contentRange: null } });

    const check = await checkAiTextRetention(now);

    expect(check.status).toBe('fail');
    expect(check.detail).toBe('MissingCountError');
  });
});

describe('a check that misses its deadline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    isKnowledgeIndexLoaded.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A degraded dependency can blow the deadline and only *then* reject - a
   * Supabase call that takes 7s and comes back with a `42501`. The report is
   * already written and returned by that point, so the late rejection has
   * nowhere to go.
   *
   * It must not escape as an `unhandledRejection`. This whole branch turns on
   * the handled/unhandled distinction: Sentry's Node SDK captures an unhandled
   * one on its own, so an escape would manufacture a second, spurious issue
   * during exactly the outage `/api/health` exists to report cleanly, and would
   * contradict this module's `runHealthChecks never throws` contract.
   */
  it('absorbs a rejection arriving after the timeout already answered', async () => {
    const escaped: unknown[] = [];
    const onUnhandled = (err: unknown) => escaped.push(err);
    process.on('unhandledRejection', onUnhandled);

    try {
      let rejectLate: (err: Error) => void = () => {};
      loadKnowledgeIndex.mockReturnValue(
        new Promise((_resolve, reject) => {
          rejectLate = reject;
        }),
      );

      vi.useFakeTimers();
      const pending = checkRagIndex();
      await vi.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS + 1);
      const check = await pending;
      vi.useRealTimers();

      expect(check.status).toBe('fail');
      expect(check.detail).toBe('HealthCheckTimeoutError');

      rejectLate(new Error('the dependency finally answered, badly'));
      // Node decides a rejection is unhandled at the end of a turn, so give it
      // two before concluding that nothing escaped.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(escaped).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
