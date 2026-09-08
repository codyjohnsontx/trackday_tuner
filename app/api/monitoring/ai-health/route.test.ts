import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAdminClient, getMonitoringCronSecret, getMonitoringAlertWebhookUrl } = vi.hoisted(
  () => ({
    createAdminClient: vi.fn(),
    getMonitoringCronSecret: vi.fn(),
    getMonitoringAlertWebhookUrl: vi.fn(),
  }),
);

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
vi.mock('@/lib/env.server', () => ({ getMonitoringCronSecret, getMonitoringAlertWebhookUrl }));

import { GET } from '@/app/api/monitoring/ai-health/route';
import type { AiRequestRow } from '@/lib/monitoring/ai-health';

const SECRET = 'cron-secret-value';
const WEBHOOK = 'https://hooks.example.test/services/abc';

function supabaseReturning(result: { data: AiRequestRow[] | null; error: { message: string } | null }) {
  const limit = vi.fn().mockResolvedValue(result);
  const order = vi.fn(() => ({ limit }));
  const gte = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ gte }));
  const from = vi.fn(() => ({ select }));
  return { from, select, gte, order, limit };
}

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://app.test/api/monitoring/ai-health', { headers });
}

function authorized(): NextRequest {
  return request({ authorization: `Bearer ${SECRET}` });
}

function recent(status: string, latencyMs: number | null = null): AiRequestRow {
  return { status, latency_ms: latencyMs, created_at: new Date().toISOString() };
}

interface Body {
  status: string;
  notified: string;
  message: string;
  alert: { firing: boolean; reasons: string[] };
  summary?: { failure: number; success: number; terminal: number };
  error?: string;
}

describe('GET /api/monitoring/ai-health', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  // Stubbed rather than spied: `fetch` is overloaded, and `vi.spyOn` over an
  // overloaded global does not typecheck.
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    getMonitoringCronSecret.mockReturnValue(SECRET);
    getMonitoringAlertWebhookUrl.mockReturnValue(null);
    createAdminClient.mockReturnValue(supabaseReturning({ data: [], error: null }));
  });

  afterEach(() => {
    // Restored here rather than at the end of each test so a throwing body
    // cannot leak a silenced console or a stubbed fetch into the next file.
    consoleError.mockRestore();
    vi.unstubAllGlobals();
  });

  function unconfigured(): void {
    getMonitoringCronSecret.mockImplementation(() => {
      throw new Error('Missing environment variable: MONITORING_CRON_SECRET');
    });
  }

  describe('authorization', () => {
    it('refuses a caller with no bearer token', async () => {
      const response = await GET(request());
      expect(response.status).toBe(401);
      expect(createAdminClient).not.toHaveBeenCalled();
    });

    it('refuses a wrong secret', async () => {
      const response = await GET(request({ authorization: 'Bearer wrong-secret-value' }));
      expect(response.status).toBe(401);
      expect(createAdminClient).not.toHaveBeenCalled();
    });

    // A shorter guess must not be told it was the wrong length by a thrown 500;
    // `timingSafeEqual` throws on a length mismatch.
    it('refuses a secret of a different length without throwing', async () => {
      const response = await GET(request({ authorization: 'Bearer short' }));
      expect(response.status).toBe(401);
    });

    it('accepts the secret however the scheduler cased the scheme', async () => {
      const response = await GET(request({ authorization: `bearer ${SECRET}` }));
      expect(response.status).toBe(200);
    });

    // Fail closed: without the secret there is no way to tell the scheduler
    // from anyone else, and these numbers are not public.
    it('refuses everyone when the secret is not configured', async () => {
      unconfigured();
      const response = await GET(authorized());
      expect(response.status).toBe(503);
      expect(createAdminClient).not.toHaveBeenCalled();
    });

    // Reporting is a resource, and this endpoint is named in a public
    // repository. The unconfigured state is documented and expected until the
    // operator finishes step 2, so no caller may turn it into a Sentry event
    // and a log line per request.
    //
    // `Bearer x` is the case that matters: any bearer value at all gets past
    // the header check and reaches the unconfigured branch, so covering only a
    // header-less request would leave the whole hole open.
    it.each([
      ['no authorization header', () => request()],
      ['an arbitrary bearer value', () => request({ authorization: 'Bearer x' })],
      ['a well-formed but wrong secret', () => request({ authorization: 'Bearer wrong-secret-value' })],
    ])('reports nothing to a caller presenting %s', async (_label, build) => {
      unconfigured();

      const response = await GET(build());

      expect([401, 503]).toContain(response.status);
      expect(consoleError).not.toHaveBeenCalled();
      expect(createAdminClient).not.toHaveBeenCalled();
    });
  });

  it('answers 200 and posts nothing when the window is healthy', async () => {
    createAdminClient.mockReturnValue(
      supabaseReturning({ data: [recent('ok', 1_200), recent('completed_refusal_prompt_injection')], error: null }),
    );

    const response = await GET(authorized());
    const body = (await response.json()) as Body;

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.alert.firing).toBe(false);
    expect(body.notified).toBe('none');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // This is the R3 shape: a handful of requests, all of them 500ing.
  it('answers 503 when the window holds a failure, so the caller fails too', async () => {
    createAdminClient.mockReturnValue(
      supabaseReturning({ data: [recent('error')], error: null }),
    );

    const response = await GET(authorized());
    const body = (await response.json()) as Body;

    expect(response.status).toBe(503);
    expect(body.status).toBe('alerting');
    expect(body.summary?.failure).toBe(1);
    expect(body.message).toContain('error=1');
  });

  it('posts the alert to the webhook when one is configured', async () => {
    getMonitoringAlertWebhookUrl.mockReturnValue(WEBHOOK);
    createAdminClient.mockReturnValue(
      supabaseReturning({ data: [recent('upstream_timeout')], error: null }),
    );

    const response = await GET(authorized());
    const body = (await response.json()) as Body;

    expect(body.notified).toBe('webhook');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK);
    const posted = JSON.parse(init.body as string) as { text: string; content: string };
    // Slack reads `text`, Discord reads `content`; one payload renders in either.
    expect(posted.text).toContain('upstream_timeout=1');
    expect(posted.content).toBe(posted.text);
    expect(response.status).toBe(503);
  });

  it('still reports the alert when the webhook itself is broken', async () => {
    getMonitoringAlertWebhookUrl.mockReturnValue(WEBHOOK);
    fetchSpy.mockRejectedValue(new Error('socket hang up'));
    createAdminClient.mockReturnValue(
      supabaseReturning({ data: [recent('error')], error: null }),
    );

    const response = await GET(authorized());
    const body = (await response.json()) as Body;

    expect(response.status).toBe(503);
    expect(body.notified).toBe('failed');
  });

  // The read that answers "is anything broken" being broken is itself an alert.
  it('answers 503 when the ai_requests read fails', async () => {
    createAdminClient.mockReturnValue(
      supabaseReturning({ data: null, error: { message: 'connection refused' } }),
    );

    const response = await GET(authorized());
    const body = (await response.json()) as Body;

    expect(response.status).toBe(503);
    expect(body.error).toBe('ai_requests_read_failed');
    expect(consoleError).toHaveBeenCalled();
  });

  it('is never served from a cache', async () => {
    const response = await GET(authorized());
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
});
