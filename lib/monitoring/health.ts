/**
 * The checks behind `/api/health`.
 *
 * This exists because of R3 (053c545): `data/rag-index.json` was gitignored,
 * never reached a Vercel bundle, and every Race Engineer call returned 500 for
 * roughly three months. Nothing noticed, because there was nothing to notice:
 * the catch wrote an `ai_requests` row and returned without logging a line, so
 * the only signal was that table quietly not growing - an outage that looks
 * exactly like riders losing interest.
 *
 * So the two things a deployment can be broken in while still serving pages are
 * checked here, and a failure is reported as a non-2xx so an external monitor
 * (or the scheduled probe in `.github/workflows/monitoring.yml`) can see it
 * without anyone reading a log:
 *
 * - Postgres is reachable through the Data API
 * - the RAG index actually loads in this bundle
 * - the Data API still exposes the RPCs the app calls (`schema_contract`), which
 *   is the Save Outcome outage: nothing applies migrations automatically, so the
 *   deployed code can be ahead of the deployed schema and only the one feature
 *   that needs the missing function says so - to the rider, as a lost save
 * - no retained rider question text, and no `ai_requests` preview, has outlived
 *   its 90 days (`ai_text_retention`), which is the only proof the purge job runs
 *
 * `runHealthChecks` never throws. A health endpoint that 500s tells you only
 * that it 500'd; one that answers `503` with a named failing check tells you
 * what to go and fix.
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { reportError } from '@/lib/monitoring/report-error';
import { isKnowledgeIndexLoaded, loadKnowledgeIndex } from '@/lib/rag/retriever';
import { REQUIRED_RPCS, findUnresolvableRpcs } from '@/lib/monitoring/schema-contract';

export type HealthCheckStatus = 'ok' | 'fail';

export interface HealthCheck {
  name: string;
  status: HealthCheckStatus;
  duration_ms: number;
  /**
   * A short machine-readable value: the error *name* on a failure, a summary
   * such as `75 chunks` on a success. A check with nothing to say omits it.
   *
   * This is a public endpoint, so a failure carries the name and never the
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
 * `profiles` is the table every other feature is built on, so one query reaches
 * the database, the grants and the service-role key. The single `id` it selects
 * never leaves this process: a check carries a name, a duration and - on a
 * failure - an error name, so no rider's data can reach the public response.
 *
 * It is deliberately a GET. Over HEAD, PostgREST answers with no body at all,
 * which leaves `postgrest-js` unable to parse the error payload: it reports a
 * `404` as a bodyless `204` with no error, so a dropped table or a stale schema
 * cache (`PGRST205`) would read as a healthy deployment, and every other
 * rejection would lose its code.
 */
export async function checkSupabase(): Promise<HealthCheck> {
  return timed('supabase', async () => {
    const admin = createAdminClient();
    const { error } = await admin
      .from('profiles')
      .select('id')
      .limit(1);
    if (error) throw supabaseError(error);
    return undefined;
  });
}

function supabaseError(error: { message: string; code?: string }): Error {
  const wrapped = new Error(error.message);
  // A PostgREST rejection carries a code (`42501` for a missing grant); a
  // transport failure carries an empty one, so the suffix is dropped rather
  // than printed as a bare colon. Either way the message itself stays out
  // of the public body and goes to the log.
  const code = error.code?.trim();
  wrapped.name = code ? `SupabaseError:${code}` : 'SupabaseUnreachableError';
  return wrapped;
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

/**
 * The schema-drift check.
 *
 * A rider pressing "Save Outcome" against a database missing
 * `20260716000800` gets `PGRST202 Could not find the function
 * public.save_session_outcome(...) in the schema cache` and loses what they
 * typed. Nothing else about the deployment looks wrong, which is why this is
 * checked rather than waited for.
 *
 * `lib/monitoring/schema-contract.ts` owns the list and explains why the probe
 * goes through the Data API instead of `pg_proc`, and why it cannot execute what
 * it probes. A failure names the RPCs so the detail says what to go and apply -
 * these are function names from this repository, not rider data, so unlike the
 * other checks the detail here is safe to put in a public body.
 */
export async function checkSchemaContract(): Promise<HealthCheck> {
  return timed('schema_contract', async () => {
    const admin = createAdminClient();
    const missing = await findUnresolvableRpcs(admin);
    if (missing.length > 0) {
      const err = new Error(`Data API cannot resolve: ${missing.join(', ')}.`);
      // The name carries the list because `timed` reports `err.name` as the
      // detail, and a check that says only "something drifted" sends the
      // operator back to a database to find out what.
      err.name = `MissingRpcError:${missing.join(',')}`;
      throw err;
    }
    return `${REQUIRED_RPCS.length} rpcs`;
  });
}

/**
 * How far past its `retain_until` a row may be before the purge is called
 * broken. The job runs once a day, so a row waits up to 24 hours for the next
 * run; 36 hours absorbs a run up to 12 hours late, and a single missed run can
 * already trip it.
 */
export const AI_TEXT_RETENTION_GRACE_MS = 36 * 60 * 60 * 1000;

/** How long `ai_requests.prompt_redacted_preview` is kept before the purge nulls it. */
export const AI_PREVIEW_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * The 90-day promise, checked by its effect rather than by its scheduler.
 *
 * Retained rider question text (`ai_request_text`) is deleted by a `pg_cron`
 * job calling `purge_expired_ai_request_text()` once a day
 * (20260924001700). Nothing about that job is visible from the app: a hosted
 * project where it was never scheduled, or where it fails every night, looks
 * exactly like one where it works, until a rider's text outlives the notice.
 * The same job nulls the 140-character `ai_requests.prompt_redacted_preview`
 * after 90 days, and that half acts on rows every AI request writes today, so
 * it is counted too.
 * So this asks the question the notice answers - is any row older than it is
 * allowed to be? - which holds whichever trigger does the deleting, and would
 * hold unchanged if the purge moved to Vercel Cron.
 *
 * The count is a number of rows, not their content, so it is safe in the
 * public body. A missing table fails too, with its PostgREST code: the code
 * expects a schema that is not there.
 */
export async function checkAiTextRetention(now: Date = new Date()): Promise<HealthCheck> {
  return timed('ai_text_retention', async () => {
    const admin = createAdminClient();
    const textCutoff = new Date(now.getTime() - AI_TEXT_RETENTION_GRACE_MS).toISOString();
    const previewCutoff = new Date(
      now.getTime() - AI_PREVIEW_RETENTION_MS - AI_TEXT_RETENTION_GRACE_MS,
    ).toISOString();
    // A GET for the same reason `checkSupabase` makes one: over HEAD a missing
    // table reads as an empty, healthy answer.
    const [text, previews] = await Promise.all([
      admin
        .from('ai_request_text')
        .select('request_id', { count: 'exact' })
        .lt('retain_until', textCutoff)
        .limit(1),
      admin
        .from('ai_requests')
        .select('request_id', { count: 'exact' })
        .not('prompt_redacted_preview', 'is', null)
        .lt('created_at', previewCutoff)
        .limit(1),
    ]);
    const overdueText = exactCount('ai_request_text', text);
    const overduePreviews = exactCount('ai_requests', previews);
    if (overdueText > 0) {
      const err = new Error(`${overdueText} ai_request_text rows are past retain_until by more than 36 hours.`);
      err.name = `OverdueRetainedTextError:${overdueText}`;
      throw err;
    }
    if (overduePreviews > 0) {
      const err = new Error(
        `${overduePreviews} ai_requests rows keep a prompt_redacted_preview more than 90 days and 36 hours old.`,
      );
      err.name = `OverduePreviewError:${overduePreviews}`;
      throw err;
    }
    return '0 overdue';
  });
}

function exactCount(
  table: string,
  { count, error }: { count: number | null; error: { message: string; code?: string } | null },
): number {
  if (error) throw supabaseError(error);
  if (count === null) {
    // Asked for an exact count and got none: the answer cannot say the
    // promise holds, so it does not get to say so.
    const err = new Error(`${table} answered without a count.`);
    err.name = 'MissingCountError';
    throw err;
  }
  return count;
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
  const checks = await Promise.all([
    checkSupabase(),
    checkRagIndex(),
    checkSchemaContract(),
    checkAiTextRetention(now),
  ]);
  return summarizeHealth(checks, now);
}
