/**
 * Turns the `ai_requests` audit table into monitoring.
 *
 * The table has recorded `status` and `latency_ms` per request since April, and
 * that was instrumentation nobody was watching: during R3 (053c545) every Race
 * Engineer call wrote a failure row for roughly three months and the only thing
 * that read them was a manual audit. Everything here is pure so the thresholds
 * can be argued with in a test rather than in production.
 *
 * The window, the thresholds and the classification are constants rather than
 * environment variables on purpose. They are load-bearing enough that changing
 * one should be a diff somebody reviews, and an incident that needs a different
 * threshold needs a deploy anyway.
 */

/**
 * How far back a run looks. The scheduled probe runs every 15 minutes, so a
 * 60-minute window means a short outage is still reported four times before it
 * ages out.
 */
export const AI_HEALTH_WINDOW_MINUTES = 60;

/**
 * A `pending` row older than this never reached its terminal update, which
 * means the function died before its own catch block could run - a platform
 * timeout or an OOM. That is invisible in every other column, so it counts as a
 * failure rather than as traffic in flight.
 */
export const PENDING_STALE_MS = 5 * 60 * 1000;

/** Fires on a proportion of failures once there is enough traffic to have one. */
export const ERROR_RATE_THRESHOLD = 0.2;
export const MIN_REQUESTS_FOR_RATE = 5;

/**
 * Fires on an absolute count regardless of traffic, and this is the rule that
 * would have caught R3. Error *rate* alone would not have: riders stopped
 * calling a feature that never worked, so the window that mattered held one or
 * two requests and would have been suppressed by `MIN_REQUESTS_FOR_RATE` every
 * time. At this product's volume a single 500 is worth an alert.
 */
export const ERROR_COUNT_THRESHOLD = 1;

/** The model itself is the slow part; past this something is wrong upstream. */
export const P95_LATENCY_THRESHOLD_MS = 15_000;

export type RequestOutcome = 'success' | 'expected' | 'failure' | 'in_flight';

/** A request the rider got advice from. */
const SUCCESS_STATUSES = new Set(['ok', 'ok_confidence_downgraded']);

/**
 * A request the product deliberately declined. Every one of these is a guard
 * doing its job and a rider getting a considered answer, so none of them is an
 * outage. Refusals are prefix-matched because the suffix is a policy violation
 * name, which is open-ended.
 */
const EXPECTED_STATUSES = new Set([
  'rate_limited_hour',
  'rate_limited_minute',
  'duplicate_recent_request',
]);
const EXPECTED_STATUS_PREFIXES = ['completed_refusal_'];

/** A request that failed and returned 5xx to the rider. */
const FAILURE_STATUSES = new Set([
  'error',
  'upstream_timeout',
  'context_lookup_error',
  'rate_limit_lookup_error',
]);

export interface AiRequestRow {
  status: string;
  latency_ms: number | null;
  created_at: string;
}

/**
 * An unrecognised status is a FAILURE, not a success.
 *
 * This is the fail-safe direction and it is the whole lesson of R3. A monitor
 * that quietly treats what it does not understand as healthy reproduces the
 * exact defect it exists to catch; one that shouts about a status nobody taught
 * it costs a two-line diff, and the alert payload names the status so the fix
 * is obvious. `lib/rag/ai-request-log.ts` and the two AI routes are where the
 * statuses are written.
 */
export function classifyRequest(row: AiRequestRow, now: Date): RequestOutcome {
  if (row.status === 'pending') {
    const age = now.getTime() - new Date(row.created_at).getTime();
    return age > PENDING_STALE_MS ? 'failure' : 'in_flight';
  }
  if (SUCCESS_STATUSES.has(row.status)) return 'success';
  if (EXPECTED_STATUSES.has(row.status)) return 'expected';
  if (EXPECTED_STATUS_PREFIXES.some((prefix) => row.status.startsWith(prefix))) return 'expected';
  if (FAILURE_STATUSES.has(row.status)) return 'failure';
  return 'failure';
}

export interface AiHealthSummary {
  window_minutes: number;
  /** Everything that reached a verdict: success + expected + failure. */
  terminal: number;
  success: number;
  expected: number;
  failure: number;
  in_flight: number;
  /** failure / terminal, or 0 when nothing terminated. */
  error_rate: number;
  p95_latency_ms: number | null;
  /** Counts per status, failures only, so an alert can name what broke. */
  failures_by_status: Record<string, number>;
}

/**
 * Nearest-rank p95: the smallest observed value at or above the 95th
 * percentile. No interpolation, so the number printed is one a request actually
 * took.
 */
export function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

export function summarizeAiRequests(
  rows: AiRequestRow[],
  now: Date,
  windowMinutes: number = AI_HEALTH_WINDOW_MINUTES,
): AiHealthSummary {
  const counts: Record<RequestOutcome, number> = {
    success: 0,
    expected: 0,
    failure: 0,
    in_flight: 0,
  };
  const failuresByStatus: Record<string, number> = {};
  const latencies: number[] = [];

  for (const row of rows) {
    const outcome = classifyRequest(row, now);
    counts[outcome] += 1;
    if (outcome === 'failure') {
      // A stale `pending` row is reported under its own name rather than as
      // "pending", which would read like ordinary traffic in the alert.
      const label = row.status === 'pending' ? 'stale_pending' : row.status;
      failuresByStatus[label] = (failuresByStatus[label] ?? 0) + 1;
    }
    if (typeof row.latency_ms === 'number' && Number.isFinite(row.latency_ms)) {
      latencies.push(row.latency_ms);
    }
  }

  const terminal = counts.success + counts.expected + counts.failure;
  return {
    window_minutes: windowMinutes,
    terminal,
    success: counts.success,
    expected: counts.expected,
    failure: counts.failure,
    in_flight: counts.in_flight,
    error_rate: terminal === 0 ? 0 : counts.failure / terminal,
    p95_latency_ms: percentile(latencies, 0.95),
    failures_by_status: failuresByStatus,
  };
}

export interface AiHealthAlert {
  firing: boolean;
  reasons: string[];
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function describeFailures(summary: AiHealthSummary): string {
  const parts = Object.entries(summary.failures_by_status)
    .sort(([, a], [, b]) => b - a)
    .map(([status, count]) => `${status}=${count}`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

export function evaluateAiHealth(summary: AiHealthSummary): AiHealthAlert {
  const reasons: string[] = [];

  if (summary.failure >= ERROR_COUNT_THRESHOLD) {
    reasons.push(
      `${summary.failure} failed AI request${summary.failure === 1 ? '' : 's'} in the last ` +
        `${summary.window_minutes} minutes${describeFailures(summary)}`,
    );
  }

  if (summary.terminal >= MIN_REQUESTS_FOR_RATE && summary.error_rate >= ERROR_RATE_THRESHOLD) {
    reasons.push(
      `error rate ${formatRate(summary.error_rate)} over ${summary.terminal} requests is at or ` +
        `above the ${formatRate(ERROR_RATE_THRESHOLD)} threshold`,
    );
  }

  if (summary.p95_latency_ms !== null && summary.p95_latency_ms >= P95_LATENCY_THRESHOLD_MS) {
    reasons.push(
      `p95 latency ${summary.p95_latency_ms}ms is at or above the ` +
        `${P95_LATENCY_THRESHOLD_MS}ms threshold`,
    );
  }

  return { firing: reasons.length > 0, reasons };
}

/** The one-line summary a webhook renders in a chat client. */
export function describeAiHealth(summary: AiHealthSummary, alert: AiHealthAlert): string {
  if (!alert.firing) {
    return `Trackday Tuner AI is healthy: ${summary.success}/${summary.terminal} requests succeeded in the last ${summary.window_minutes} minutes.`;
  }
  return `Trackday Tuner AI alert - ${alert.reasons.join('; ')}.`;
}
