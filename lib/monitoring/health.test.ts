import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
// Mocked wholesale rather than spied: the real module imports `server-only`,
// which does not resolve in the node-environment unit suite. Nothing here
// exercises the RAG check.
vi.mock('@/lib/rag/retriever', () => ({
  loadKnowledgeIndex: vi.fn(),
  isKnowledgeIndexLoaded: vi.fn(),
}));

import { checkSupabase } from '@/lib/monitoring/health';

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
