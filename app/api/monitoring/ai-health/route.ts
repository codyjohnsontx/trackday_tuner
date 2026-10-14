import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { refuseUnlessScheduler } from '@/lib/monitoring/cron-auth';
import { deliverAlert } from '@/lib/monitoring/alert';
import { reportError } from '@/lib/monitoring/report-error';
import {
  AI_HEALTH_WINDOW_MINUTES,
  describeAiHealth,
  evaluateAiHealth,
  summarizeAiRequests,
  type AiRequestRow,
} from '@/lib/monitoring/ai-health';

/**
 * The scheduled alert over `ai_requests`.
 *
 * Called every 15 minutes by `.github/workflows/monitoring.yml`, behind
 * `refuseUnlessScheduler` (`lib/monitoring/cron-auth.ts`). It computes the
 * error rate and p95 latency over the last hour, posts to the webhook when a
 * threshold is crossed, and answers `503` so the caller fails too. The thresholds and what counts as a failure live in
 * `lib/monitoring/ai-health.ts`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A cap so one runaway hour cannot turn a monitoring call into a full table
 * scan. Reaching it is itself reported, because a silently truncated window
 * would understate the very numbers this route exists to compute.
 */
const MAX_ROWS = 10_000;

/**
 * How long the `ai_requests` read gets before it is abandoned.
 *
 * Without this the query can stay pending until the platform kills the function,
 * which never reaches the `catch` below - so the probe would time out rather
 * than answer, and a monitor that hangs is a monitor that does not alert. The
 * catch turns a slow database into the `503` the workflow is watching for, which
 * is the outcome this route exists to produce. `/api/health` protects its own
 * checks the same way, with `HEALTH_CHECK_TIMEOUT_MS`.
 */
const AI_REQUESTS_READ_TIMEOUT_MS = 10_000;

export async function GET(request: NextRequest) {
  const refused = refuseUnlessScheduler(request);
  if (refused) return refused;

  const now = new Date();
  const since = new Date(now.getTime() - AI_HEALTH_WINDOW_MINUTES * 60 * 1000);

  let rows: AiRequestRow[];
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('ai_requests')
      .select('status, latency_ms, created_at')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS)
      .abortSignal(AbortSignal.timeout(AI_REQUESTS_READ_TIMEOUT_MS));
    if (error) throw new Error(error.message);
    rows = data ?? [];
  } catch (err) {
    // The read that answers "is anything broken" being broken is itself an
    // alert, and the caller has to see it as one.
    reportError('monitoring', err, { reason: 'ai_requests read failed' });
    const text = 'Trackday Tuner AI alert - the monitoring query itself failed.';
    const notified = await deliverAlert(text, { error: 'ai_requests_read_failed' });
    return NextResponse.json(
      { status: 'unknown', checked_at: now.toISOString(), error: 'ai_requests_read_failed', notified },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  const summary = summarizeAiRequests(rows, now);
  const alert = evaluateAiHealth(summary);
  if (rows.length >= MAX_ROWS) {
    alert.firing = true;
    alert.reasons.push(
      `the window held at least ${MAX_ROWS} rows, so these numbers are truncated`,
    );
  }

  const text = describeAiHealth(summary, alert);
  const notified = alert.firing ? await deliverAlert(text, summary) : 'none';

  return NextResponse.json(
    {
      status: alert.firing ? 'alerting' : 'ok',
      checked_at: now.toISOString(),
      summary,
      alert,
      notified,
      message: text,
    },
    {
      // 503 so `curl --fail` in the scheduled workflow fails the run, which is
      // what notifies the operator when no webhook is configured.
      status: alert.firing ? 503 : 200,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
