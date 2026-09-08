/**
 * The checks behind `/api/health`.
 *
 * This exists because of R3 (053c545): `data/rag-index.json` was gitignored,
 * never reached a Vercel bundle, and every Race Engineer call returned 500 for
 * roughly three months. Nothing noticed, because the only signal was a
 * `console.error` in a log nobody was reading and an `ai_requests` table that
 * simply stopped growing - an outage that looks exactly like riders losing
 * interest.
 *
 * So the two things a deployment can be broken in while still serving pages are
 * checked here, and a failure is reported as a non-2xx so an external monitor
 * (or the scheduled probe in `.github/workflows/monitoring.yml`) can see it
 * without anyone reading a log:
 *
 * - Postgres is reachable through the Data API
 * - the RAG index actually loads in this bundle
 *
 * `runHealthChecks` never throws. A health endpoint that 500s tells you only
 * that it 500'd; one that answers `503` with a named failing check tells you
 * what to go and fix.
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { reportError } from '@/lib/monitoring/report-error';
import { isKnowledgeIndexLoaded, loadKnowledgeIndex } from '@/lib/rag/retriever';

export type HealthCheckStatus = 'ok' | 'fail';

export interface HealthCheck {
  name: string;
  status: HealthCheckStatus;
  duration_ms: number;
  /**
   * A short machine-readable reason, present only on a failure.
   *
   * This is a public endpoint, so it carries an error *name* and never a
   * message: `MissingKnowledgeIndexError`'s own message embeds the absolute
   * index path, and the Supabase errors embed table and column names. The full
   * detail goes to the server log (and therefore to Sentry) instead.
   */
  detail?: string;
}

export interface HealthReport {
  status: 'ok' | 'unhealthy';
  checked_at: string;
  checks: HealthCheck[];
}

/** Milliseconds a single check may take before it is called a failure. */
export const HEALTH_CHECK_TIMEOUT_MS = 5_000;

class HealthCheckTimeoutError extends Error {
  constructor() {
    super('Health check timed out.');
    this.name = 'HealthCheckTimeoutError';
  }
}

/**
 * A hung dependency is an outage, and without this the probe would hang with
 * it: an external monitor would record a timeout rather than a `503`, and the
 * report would never say which check was the one that stopped answering.
 */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new HealthCheckTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function errorName(err: unknown): string {
  if (err instanceof Error && err.name) return err.name;
  return 'UnknownError';
}

async function timed(
  name: string,
  run: () => Promise<string | undefined>,
): Promise<HealthCheck> {
  const startedAt = Date.now();
  try {
    const detail = await withTimeout(run(), HEALTH_CHECK_TIMEOUT_MS);
    const check: HealthCheck = { name, status: 'ok', duration_ms: Date.now() - startedAt };
    if (detail !== undefined) check.detail = detail;
    return check;
  } catch (err) {
    // The only place the real error survives - the response body deliberately
    // does not carry it. This is a caught error, so it reaches Sentry only
    // because `reportError` sends it: `onRequestError` sees unhandled ones.
    reportError('health', err, { check: name });
    return { name, status: 'fail', duration_ms: Date.now() - startedAt, detail: errorName(err) };
  }
}

/**
 * A round trip to Postgres through PostgREST.
 *
 * `head: true` means no row is transferred, so this reaches the database, the
 * grants and the service-role key without putting a single rider's data in a
 * public response. `profiles` is the table every other feature is built on.
 */
export async function checkSupabase(): Promise<HealthCheck> {
  return timed('supabase', async () => {
    const admin = createAdminClient();
    const { error } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    if (error) {
      const wrapped = new Error(error.message);
      // A PostgREST rejection carries a code (`42501` for a missing grant); a
      // transport failure carries an empty one, so the suffix is dropped rather
      // than printed as a bare colon. Either way the message itself stays out
      // of the public body and goes to the log.
      const code = error.code?.trim();
      wrapped.name = code ? `SupabaseError:${code}` : 'SupabaseUnreachableError';
      throw wrapped;
    }
    return undefined;
  });
}

/**
 * The R3 check.
 *
 * `loadKnowledgeIndex` throws `MissingKnowledgeIndexError` when the file is not
 * in this bundle and `ZeroVectorIndexError` when it was built without an API
 * key, which are the two ways the index has actually been broken. Both surface
 * here as a failed check and a `503`.
 *
 * The `isKnowledgeIndexLoaded` assertion afterwards is a post-condition rather
 * than a second way to fail: the AI routes read that module-level cache on
 * every warm invocation, so a `loadKnowledgeIndex` that resolved without
 * populating it would leave them re-reading the file from disk per request with
 * nothing to say so.
 */
export async function checkRagIndex(): Promise<HealthCheck> {
  return timed('rag_index', async () => {
    const index = await loadKnowledgeIndex();
    if (!isKnowledgeIndexLoaded()) {
      const err = new Error('Knowledge index resolved without populating the cache.');
      err.name = 'KnowledgeIndexNotCachedError';
      throw err;
    }
    const chunkCount = index.chunks?.length ?? 0;
    if (chunkCount === 0) {
      const err = new Error('Knowledge index loaded with no chunks.');
      err.name = 'EmptyKnowledgeIndexError';
      throw err;
    }
    return `${chunkCount} chunks`;
  });
}

export function summarizeHealth(checks: HealthCheck[], checkedAt: Date): HealthReport {
  return {
    status: checks.some((check) => check.status === 'fail') ? 'unhealthy' : 'ok',
    checked_at: checkedAt.toISOString(),
    checks,
  };
}

/** 200 when everything answered, 503 when anything did not. */
export function healthHttpStatus(report: HealthReport): 200 | 503 {
  return report.status === 'ok' ? 200 : 503;
}

export async function runHealthChecks(now: Date = new Date()): Promise<HealthReport> {
  const checks = await Promise.all([checkSupabase(), checkRagIndex()]);
  return summarizeHealth(checks, now);
}
