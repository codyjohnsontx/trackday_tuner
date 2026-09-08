import { describe, expect, it } from 'vitest';
import {
  ERROR_RATE_THRESHOLD,
  MIN_REQUESTS_FOR_RATE,
  P95_LATENCY_THRESHOLD_MS,
  PENDING_STALE_MS,
  classifyRequest,
  describeAiHealth,
  evaluateAiHealth,
  percentile,
  summarizeAiRequests,
  type AiRequestRow,
} from '@/lib/monitoring/ai-health';

const NOW = new Date('2026-09-08T12:00:00.000Z');

function row(status: string, overrides: Partial<AiRequestRow> = {}): AiRequestRow {
  return {
    status,
    latency_ms: null,
    created_at: new Date(NOW.getTime() - 60_000).toISOString(),
    ...overrides,
  };
}

function evaluate(rows: AiRequestRow[]) {
  return evaluateAiHealth(summarizeAiRequests(rows, NOW));
}

describe('classifyRequest', () => {
  it('counts a delivered answer as a success', () => {
    expect(classifyRequest(row('ok'), NOW)).toBe('success');
    expect(classifyRequest(row('ok_confidence_downgraded'), NOW)).toBe('success');
  });

  // Every one of these is a guard working. Counting them as errors would make
  // the alert fire hardest exactly when the product is behaving best.
  it.each([
    'completed_refusal_prompt_injection',
    'completed_refusal_stored_text_injection',
    'completed_refusal_unsafe_magnitude',
    'completed_refusal_no_safe_answer',
    'rate_limited_hour',
    'rate_limited_minute',
    'duplicate_recent_request',
  ])('counts %s as expected rather than as an error', (status) => {
    expect(classifyRequest(row(status), NOW)).toBe('expected');
  });

  it.each(['error', 'upstream_timeout', 'context_lookup_error', 'rate_limit_lookup_error'])(
    'counts %s as a failure',
    (status) => {
      expect(classifyRequest(row(status), NOW)).toBe('failure');
    },
  );

  it('treats a fresh pending row as traffic in flight', () => {
    const fresh = row('pending', { created_at: new Date(NOW.getTime() - 1_000).toISOString() });
    expect(classifyRequest(fresh, NOW)).toBe('in_flight');
  });

  // The function died before its own catch block could write a terminal status:
  // a platform timeout or an OOM, invisible in every other column.
  it('treats a stale pending row as a failure', () => {
    const stale = row('pending', {
      created_at: new Date(NOW.getTime() - PENDING_STALE_MS - 1_000).toISOString(),
    });
    expect(classifyRequest(stale, NOW)).toBe('failure');
  });

  // Fail-safe: a monitor that treats what it does not understand as healthy is
  // the defect it exists to catch.
  it('treats an unrecognised status as a failure', () => {
    expect(classifyRequest(row('some_status_added_later'), NOW)).toBe('failure');
  });
});

describe('percentile', () => {
  it('has no answer for no observations', () => {
    expect(percentile([], 0.95)).toBeNull();
  });

  it('returns a value a request actually took', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 0.95)).toBe(100);
    expect(percentile(values, 0.5)).toBe(50);
  });

  it('handles a single observation', () => {
    expect(percentile([42], 0.95)).toBe(42);
  });
});

describe('summarizeAiRequests', () => {
  it('reports an empty window as healthy rather than as 0% success', () => {
    const summary = summarizeAiRequests([], NOW);
    expect(summary.terminal).toBe(0);
    expect(summary.error_rate).toBe(0);
    expect(summary.p95_latency_ms).toBeNull();
    expect(evaluateAiHealth(summary).firing).toBe(false);
  });

  it('keeps in-flight requests out of the rate', () => {
    const summary = summarizeAiRequests(
      [
        row('ok'),
        row('pending', { created_at: new Date(NOW.getTime() - 1_000).toISOString() }),
      ],
      NOW,
    );
    expect(summary.terminal).toBe(1);
    expect(summary.in_flight).toBe(1);
    expect(summary.error_rate).toBe(0);
  });

  it('names a stale pending row rather than filing it under "pending"', () => {
    const summary = summarizeAiRequests(
      [row('pending', { created_at: new Date(NOW.getTime() - PENDING_STALE_MS - 1).toISOString() })],
      NOW,
    );
    expect(summary.failures_by_status).toEqual({ stale_pending: 1 });
  });

  it('takes p95 over every row that reached the model', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row('ok', { latency_ms: (i + 1) * 100 }),
    );
    expect(summarizeAiRequests(rows, NOW).p95_latency_ms).toBe(1900);
  });
});

describe('evaluateAiHealth', () => {
  // R3: the AI 500'd on every call for three months and traffic collapsed to
  // almost nothing, so a rate rule with a minimum sample would have stayed
  // silent every single time it ran.
  it('fires on one failure in an otherwise empty window', () => {
    const alert = evaluate([row('error')]);
    expect(alert.firing).toBe(true);
    expect(alert.reasons[0]).toContain('1 failed AI request');
    expect(alert.reasons[0]).toContain('error=1');
  });

  it('does not fire on a window of successes and refusals', () => {
    const rows = [
      ...Array.from({ length: 10 }, () => row('ok', { latency_ms: 2_000 })),
      row('completed_refusal_prompt_injection'),
      row('rate_limited_hour'),
    ];
    expect(evaluate(rows).firing).toBe(false);
  });

  it('fires on the error rate once there is enough traffic', () => {
    const rows = [
      ...Array.from({ length: MIN_REQUESTS_FOR_RATE }, () => row('ok')),
      ...Array.from({ length: MIN_REQUESTS_FOR_RATE }, () => row('upstream_timeout')),
    ];
    const alert = evaluate(rows);
    expect(alert.firing).toBe(true);
    expect(alert.reasons.some((reason) => reason.includes('error rate'))).toBe(true);
  });

  it('suppresses only the rate rule below the minimum sample, never the count rule', () => {
    const summary = summarizeAiRequests([row('ok'), row('error')], NOW);
    expect(summary.terminal).toBeLessThan(MIN_REQUESTS_FOR_RATE);
    expect(summary.error_rate).toBeGreaterThanOrEqual(ERROR_RATE_THRESHOLD);
    const alert = evaluateAiHealth(summary);
    expect(alert.reasons.some((reason) => reason.includes('error rate'))).toBe(false);
    expect(alert.firing).toBe(true);
  });

  it('fires on p95 latency with no errors at all', () => {
    const rows = Array.from({ length: 20 }, () =>
      row('ok', { latency_ms: P95_LATENCY_THRESHOLD_MS + 500 }),
    );
    const alert = evaluate(rows);
    expect(alert.firing).toBe(true);
    expect(alert.reasons).toHaveLength(1);
    expect(alert.reasons[0]).toContain('p95 latency');
  });
});

describe('describeAiHealth', () => {
  it('says what broke, not that something did', () => {
    const summary = summarizeAiRequests([row('error'), row('upstream_timeout')], NOW);
    const text = describeAiHealth(summary, evaluateAiHealth(summary));
    expect(text).toContain('2 failed AI requests');
    expect(text).toContain('error=1');
    expect(text).toContain('upstream_timeout=1');
  });

  it('reads as an all-clear when nothing is firing', () => {
    const summary = summarizeAiRequests([row('ok')], NOW);
    expect(describeAiHealth(summary, evaluateAiHealth(summary))).toContain('healthy');
  });
});
