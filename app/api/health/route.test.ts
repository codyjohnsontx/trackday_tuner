import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAdminClient, loadKnowledgeIndex, isKnowledgeIndexLoaded } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  loadKnowledgeIndex: vi.fn(),
  isKnowledgeIndexLoaded: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
// Mocked wholesale rather than spied: the real module imports `server-only`,
// which does not resolve in the node-environment unit suite.
vi.mock('@/lib/rag/retriever', () => ({ loadKnowledgeIndex, isKnowledgeIndexLoaded }));

import { GET } from '@/app/api/health/route';
import { HEALTH_CHECK_TIMEOUT_MS } from '@/lib/monitoring/health';

const INDEX_PATH = '/var/task/data/rag-index.json';

class MissingKnowledgeIndexError extends Error {
  constructor() {
    super(`RAG index not found at ${INDEX_PATH}.`);
    this.name = 'MissingKnowledgeIndexError';
  }
}

class ZeroVectorIndexError extends Error {
  constructor() {
    super('RAG index contains only zero-vector embeddings.');
    this.name = 'ZeroVectorIndexError';
  }
}

function supabaseReturning(
  result: { error: { message: string; code?: string } | null },
  // What PostgREST says to the `schema_contract` probes. `22P02` is what a real
  // stack answers: the function resolved, and the uncoercible probe value was
  // then rejected before its body ran.
  rpcResult: { error: { message: string; code?: string } | null } = {
    error: { code: '22P02', message: 'invalid input syntax for type uuid' },
  },
) {
  const limit = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  return { from, select, limit, rpc };
}

interface HealthCheckBody {
  name: string;
  status: 'ok' | 'fail';
  duration_ms: number;
  detail?: string;
}

interface HealthBody {
  status: 'ok' | 'unhealthy';
  checked_at: string;
  checks: HealthCheckBody[];
}

function check(body: HealthBody, name: string): HealthCheckBody {
  const found = body.checks.find((entry) => entry.name === name);
  if (!found) throw new Error(`No "${name}" check in ${JSON.stringify(body)}`);
  return found;
}

describe('GET /api/health', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    createAdminClient.mockReturnValue(supabaseReturning({ error: null }));
    loadKnowledgeIndex.mockResolvedValue({ model: 'text-embedding-3-small', chunks: [{}, {}, {}] });
    isKnowledgeIndexLoaded.mockReturnValue(true);
  });

  afterEach(() => {
    // Restored here rather than at the end of each test so a throwing body
    // cannot leak a silenced console into the next file.
    consoleError.mockRestore();
    vi.useRealTimers();
  });

  it('answers 200 with every check passing when the deployment is healthy', async () => {
    const response = await GET();
    const body = (await response.json()) as HealthBody;

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(check(body, 'supabase').status).toBe('ok');
    expect(check(body, 'rag_index').status).toBe('ok');
    expect(check(body, 'rag_index').detail).toBe('3 chunks');
    expect(check(body, 'schema_contract').status).toBe('ok');
    expect(Number.isNaN(Date.parse(body.checked_at))).toBe(false);
  });

  // The Save Outcome outage. Nothing applies migrations automatically, so the
  // deployed code can be ahead of the deployed schema; the rider finds out by
  // losing what they typed. A `503` here is what makes the scheduled probe in
  // .github/workflows/monitoring.yml fail instead.
  it('answers 503 naming the RPC when the Data API cannot resolve it', async () => {
    createAdminClient.mockReturnValue(
      supabaseReturning(
        { error: null },
        {
          error: {
            code: 'PGRST202',
            message:
              'Could not find the function public.save_session_outcome(...) in the schema cache',
          },
        },
      ),
    );

    const response = await GET();
    const body = (await response.json()) as HealthBody;

    expect(response.status).toBe(503);
    expect(body.status).toBe('unhealthy');
    expect(check(body, 'schema_contract').status).toBe('fail');
    expect(check(body, 'schema_contract').detail).toContain('save_session_outcome');
    // The other two are untouched: this failure is the schema, not the database.
    expect(check(body, 'supabase').status).toBe('ok');
    expect(check(body, 'rag_index').status).toBe('ok');
  });

  // A probe that never reached PostgREST measured nothing, so the body must not
  // say the schema is in step. `postgrest-js` resolves a transport failure as an
  // error carrying an empty `code`, which is not PGRST202 and used to read as a
  // resolved function - `schema_contract: ok, detail: 3 rpcs` while nothing had
  // answered.
  it('does not call the schema in step when the Data API never answered', async () => {
    createAdminClient.mockReturnValue(
      supabaseReturning(
        { error: null },
        { error: { code: '', message: 'TypeError: fetch failed' } },
      ),
    );

    const response = await GET();
    const body = (await response.json()) as HealthBody;

    expect(response.status).toBe(503);
    expect(check(body, 'schema_contract').status).toBe('fail');
    expect(check(body, 'schema_contract').detail).toBe('DataApiUnreachableError');
  });

  it('is never served from a cache', async () => {
    const response = await GET();
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  // R3 (053c545): the index was gitignored, never reached the bundle, and every
  // Race Engineer call 500'd for three months with nothing to say so.
  it('fails when the RAG index is not in the bundle', async () => {
    loadKnowledgeIndex.mockRejectedValue(new MissingKnowledgeIndexError());

    const response = await GET();
    const body = (await response.json()) as HealthBody;

    expect(response.status).toBe(503);
    expect(body.status).toBe('unhealthy');
    expect(check(body, 'rag_index').status).toBe('fail');
    expect(check(body, 'rag_index').detail).toBe('MissingKnowledgeIndexError');
    // The rest of the deployment being fine is exactly what made this invisible,
    // so the report has to keep saying so.
    expect(check(body, 'supabase').status).toBe('ok');
  });

  it('fails when the index was built with no API key', async () => {
    loadKnowledgeIndex.mockRejectedValue(new ZeroVectorIndexError());

    const response = await GET();
    const body = (await response.json()) as HealthBody;

    expect(response.status).toBe(503);
    expect(check(body, 'rag_index').detail).toBe('ZeroVectorIndexError');
  });

  it('fails when the index loads but carries no chunks', async () => {
    loadKnowledgeIndex.mockResolvedValue({ model: 'text-embedding-3-small', chunks: [] });

    const response = await GET();
    const body = (await response.json()) as HealthBody;

    expect(response.status).toBe(503);
    expect(check(body, 'rag_index').detail).toBe('EmptyKnowledgeIndexError');
  });

  it('fails when loading the index leaves the cache the AI routes read unpopulated', async () => {
    isKnowledgeIndexLoaded.mockReturnValue(false);

    const response = await GET();
    const body = (await response.json()) as HealthBody;

    expect(response.status).toBe(503);
    expect(check(body, 'rag_index').detail).toBe('KnowledgeIndexNotCachedError');
  });

  it('fails when PostgREST rejects the query', async () => {
    createAdminClient.mockReturnValue(
      supabaseReturning({ error: { message: 'permission denied for table profiles', code: '42501' } }),
    );

    const response = await GET();
    const body = (await response.json()) as HealthBody;

    expect(response.status).toBe(503);
    expect(check(body, 'supabase').status).toBe('fail');
    expect(check(body, 'supabase').detail).toBe('SupabaseError:42501');
    expect(check(body, 'rag_index').status).toBe('ok');
  });

  it('names a transport failure rather than printing a bare code', async () => {
    // supabase-js reports `TypeError: fetch failed` with an empty code when the
    // project is unreachable; the detail must still say something.
    createAdminClient.mockReturnValue(
      supabaseReturning({ error: { message: 'TypeError: fetch failed', code: '' } }),
    );

    const response = await GET();
    const body = (await response.json()) as HealthBody;

    expect(response.status).toBe(503);
    expect(check(body, 'supabase').detail).toBe('SupabaseUnreachableError');
  });

  it('fails when the deployment has no service role key', async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error('Missing environment variable: SUPABASE_SERVICE_ROLE_KEY');
    });

    const response = await GET();
    const body = (await response.json()) as HealthBody;

    expect(response.status).toBe(503);
    expect(check(body, 'supabase').status).toBe('fail');
  });

  // The endpoint is public and unauthenticated. `MissingKnowledgeIndexError`'s
  // own message embeds the absolute index path and a PostgREST error embeds
  // table and column names; neither belongs in the response body.
  it('reports the error name and never the message', async () => {
    loadKnowledgeIndex.mockRejectedValue(new MissingKnowledgeIndexError());
    createAdminClient.mockReturnValue(
      supabaseReturning({ error: { message: 'permission denied for table profiles', code: '42501' } }),
    );

    const response = await GET();
    const raw = await response.text();

    expect(raw).not.toContain(INDEX_PATH);
    expect(raw).not.toContain('permission denied');
    // ...and the detail still survives where an operator can read it.
    expect(consoleError).toHaveBeenCalled();
  });

  it('calls a hung dependency a failure instead of hanging with it', async () => {
    vi.useFakeTimers();
    loadKnowledgeIndex.mockReturnValue(new Promise(() => {}));

    const pending = GET();
    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS + 1);
    const response = await pending;
    const body = (await response.json()) as HealthBody;

    expect(response.status).toBe(503);
    expect(check(body, 'rag_index').detail).toBe('HealthCheckTimeoutError');
  });
});
