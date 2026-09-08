import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getMonitoringCronSecret } from '@/lib/env.server';
import { createAdminClient } from '@/lib/supabase/admin';
import { deliverAlert } from '@/lib/monitoring/alert';
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
 * Called every 15 minutes by `.github/workflows/monitoring.yml`, which presents
 * `Authorization: Bearer $MONITORING_CRON_SECRET` - the same header a Vercel
 * Cron job sends, so moving the schedule onto Vercel later needs no change
 * here. It computes the error rate and p95 latency over the last hour, posts to
 * the webhook when a threshold is crossed, and answers `503` so the caller
 * fails too. The thresholds and what counts as a failure live in
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

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
}

function presentedSecret(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, and the length of a secret is
  // not worth leaking through a thrown 500 either.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  let expected: string;
  try {
    expected = getMonitoringCronSecret();
  } catch (err) {
    // Fail closed. Without the secret there is no way to tell the scheduler
    // from anyone else, and these numbers are not public.
    console.error('[monitoring] MONITORING_CRON_SECRET is not configured', err);
    return NextResponse.json({ error: 'Monitoring is not configured.' }, { status: 503 });
  }

  const presented = presentedSecret(request);
  if (!presented || !secretMatches(presented, expected)) return unauthorized();

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
      .limit(MAX_ROWS);
    if (error) throw new Error(error.message);
    rows = data ?? [];
  } catch (err) {
    // The read that answers "is anything broken" being broken is itself an
    // alert, and the caller has to see it as one.
    console.error('[monitoring] ai_requests read failed', err);
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
