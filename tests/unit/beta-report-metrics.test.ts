import { describe, expect, it } from 'vitest';
import {
  AI_SUCCESS_STATUSES,
  GATE_TARGETS,
  computeWithinDayLoops,
  decideGate,
  summarizeAiGuidance,
  summarizeComparisonUsage,
  type LoopChangeRow,
  type LoopOutcomeRow,
  type LoopSessionRow,
} from '@/scripts/lib/beta-report-metrics.mjs';

const RIDER = 'rider-1';
const OTHER_RIDER = 'rider-2';

function session(
  id: string,
  date: string,
  start_time: string | null,
  user_id = RIDER,
  created_at = `${date}T08:00:00Z`,
): LoopSessionRow {
  return { id, user_id, date, start_time, created_at };
}

function change(session_id: string, user_id = RIDER, entries: unknown[] = [{ label: 'Preload' }]): LoopChangeRow {
  return { user_id, session_id, changes: entries };
}

function outcome(session_id: string, reference_session_id: string | null = null, user_id = RIDER): LoopOutcomeRow {
  return { user_id, session_id, reference_session_id };
}

describe('computeWithinDayLoops', () => {
  it('counts the canonical loop: two sessions, change and outcome on the second', () => {
    const result = computeWithinDayLoops({
      sessions: [session('s1', '2026-07-01', '09:00'), session('s2', '2026-07-01', '11:00')],
      changes: [change('s2')],
      outcomes: [outcome('s2', 's1')],
      riderIds: new Set([RIDER]),
    });
    expect(result.loopsByRider.get(RIDER)).toBe(1);
    expect(result.ridersWithLoop).toBe(1);
    expect(result.totalLoops).toBe(1);
  });

  it('counts a baseline change on the first session followed by an outcome on the second', () => {
    const result = computeWithinDayLoops({
      sessions: [session('s1', '2026-07-01', '09:00'), session('s2', '2026-07-01', '11:00')],
      changes: [change('s1')],
      outcomes: [outcome('s2', 's1')],
      riderIds: new Set([RIDER]),
    });
    expect(result.loopsByRider.get(RIDER)).toBe(1);
  });

  it('does not count sessions spread across different dates', () => {
    const result = computeWithinDayLoops({
      sessions: [session('s1', '2026-07-01', '09:00'), session('s2', '2026-07-02', '11:00')],
      changes: [change('s2')],
      outcomes: [outcome('s2', 's1')],
      riderIds: new Set([RIDER]),
    });
    expect(result.loopsByRider.get(RIDER)).toBe(0);
    expect(result.ridersWithLoop).toBe(0);
  });

  it('does not count an outcome on the first session of the day', () => {
    const result = computeWithinDayLoops({
      sessions: [session('s1', '2026-07-01', '09:00'), session('s2', '2026-07-01', '11:00')],
      changes: [change('s1')],
      outcomes: [outcome('s1')],
      riderIds: new Set([RIDER]),
    });
    expect(result.loopsByRider.get(RIDER)).toBe(0);
  });

  it('requires a recorded change', () => {
    const result = computeWithinDayLoops({
      sessions: [session('s1', '2026-07-01', '09:00'), session('s2', '2026-07-01', '11:00')],
      changes: [],
      outcomes: [outcome('s2', 's1')],
      riderIds: new Set([RIDER]),
    });
    expect(result.loopsByRider.get(RIDER)).toBe(0);
  });

  it('requires an outcome', () => {
    const result = computeWithinDayLoops({
      sessions: [session('s1', '2026-07-01', '09:00'), session('s2', '2026-07-01', '11:00')],
      changes: [change('s2')],
      outcomes: [],
      riderIds: new Set([RIDER]),
    });
    expect(result.loopsByRider.get(RIDER)).toBe(0);
  });

  it('ignores change records with no entries', () => {
    const result = computeWithinDayLoops({
      sessions: [session('s1', '2026-07-01', '09:00'), session('s2', '2026-07-01', '11:00')],
      changes: [change('s2', RIDER, [])],
      outcomes: [outcome('s2', 's1')],
      riderIds: new Set([RIDER]),
    });
    expect(result.loopsByRider.get(RIDER)).toBe(0);
  });

  it('does not count an outcome recorded before the first change of the day', () => {
    const result = computeWithinDayLoops({
      sessions: [
        session('s1', '2026-07-01', '09:00'),
        session('s2', '2026-07-01', '11:00'),
        session('s3', '2026-07-01', '14:00'),
      ],
      changes: [change('s3')],
      outcomes: [outcome('s2', 's1')],
      riderIds: new Set([RIDER]),
    });
    expect(result.loopsByRider.get(RIDER)).toBe(0);
  });

  it('does not count an outcome whose reference session is on a previous date', () => {
    const result = computeWithinDayLoops({
      sessions: [
        session('s0', '2026-06-30', '15:00'),
        session('s1', '2026-07-01', '09:00'),
        session('s2', '2026-07-01', '11:00'),
      ],
      changes: [change('s2')],
      outcomes: [outcome('s2', 's0')],
      riderIds: new Set([RIDER]),
    });
    expect(result.loopsByRider.get(RIDER)).toBe(0);
  });

  it('falls back to positional ordering when the reference session was deleted', () => {
    const result = computeWithinDayLoops({
      sessions: [session('s1', '2026-07-01', '09:00'), session('s2', '2026-07-01', '11:00')],
      changes: [change('s2')],
      outcomes: [outcome('s2', 'deleted-session')],
      riderIds: new Set([RIDER]),
    });
    expect(result.loopsByRider.get(RIDER)).toBe(1);
  });

  it('orders sessions by start_time, falling back to created_at when missing', () => {
    // s2 was created first but ran later in the day; s1 has no start_time and
    // sorts at 00:00, so the outcome on s2 is on a non-first session.
    const result = computeWithinDayLoops({
      sessions: [
        session('s2', '2026-07-01', '11:00', RIDER, '2026-07-01T07:00:00Z'),
        session('s1', '2026-07-01', null, RIDER, '2026-07-01T07:30:00Z'),
      ],
      changes: [change('s2')],
      outcomes: [outcome('s2', 's1')],
      riderIds: new Set([RIDER]),
    });
    expect(result.loopsByRider.get(RIDER)).toBe(1);
  });

  it('counts two loops in one day and reports repeat riders in aggregate', () => {
    const result = computeWithinDayLoops({
      sessions: [
        session('s1', '2026-07-01', '09:00'),
        session('s2', '2026-07-01', '10:30'),
        session('s3', '2026-07-01', '13:00'),
        session('s4', '2026-07-01', '15:00'),
        session('o1', '2026-07-05', '09:00', OTHER_RIDER),
        session('o2', '2026-07-05', '11:00', OTHER_RIDER),
      ],
      changes: [change('s2'), change('s4'), change('o2', OTHER_RIDER)],
      outcomes: [outcome('s2', 's1'), outcome('s4', 's3'), outcome('o2', 'o1', OTHER_RIDER)],
      riderIds: new Set([RIDER, OTHER_RIDER]),
    });
    expect(result.loopsByRider.get(RIDER)).toBe(2);
    expect(result.loopsByRider.get(OTHER_RIDER)).toBe(1);
    expect(result.ridersWithLoop).toBe(2);
    expect(result.ridersWithRepeatLoops).toBe(1);
    expect(result.totalLoops).toBe(3);
  });

  it('excludes riders outside the cohort', () => {
    const result = computeWithinDayLoops({
      sessions: [session('s1', '2026-07-01', '09:00', OTHER_RIDER), session('s2', '2026-07-01', '11:00', OTHER_RIDER)],
      changes: [change('s2', OTHER_RIDER)],
      outcomes: [outcome('s2', 's1', OTHER_RIDER)],
      riderIds: new Set([RIDER]),
    });
    expect(result.ridersWithLoop).toBe(0);
    expect(result.totalLoops).toBe(0);
  });
});

describe('summarizeComparisonUsage', () => {
  it('counts comparison_viewed events for cohort riders only', () => {
    const summary = summarizeComparisonUsage(
      [
        { user_id: RIDER, event_name: 'comparison_viewed', properties: {} },
        { user_id: RIDER, event_name: 'session_created', properties: {} },
        { user_id: OTHER_RIDER, event_name: 'comparison_viewed', properties: {} },
      ],
      new Set([RIDER]),
    );
    expect(summary.total).toBe(1);
    expect(summary.bySurface.get('unspecified')).toBe(1);
  });

  it('splits counts by properties.surface when the distinction exists', () => {
    const summary = summarizeComparisonUsage(
      [
        { user_id: RIDER, event_name: 'comparison_viewed', properties: { surface: 'inline' } },
        { user_id: RIDER, event_name: 'comparison_viewed', properties: { surface: 'inline' } },
        { user_id: RIDER, event_name: 'comparison_viewed', properties: { surface: 'page' } },
        { user_id: RIDER, event_name: 'comparison_viewed', properties: {} },
      ],
      new Set([RIDER]),
    );
    expect(summary.total).toBe(4);
    expect(summary.bySurface.get('inline')).toBe(2);
    expect(summary.bySurface.get('page')).toBe(1);
    expect(summary.bySurface.get('unspecified')).toBe(1);
  });
});

describe('summarizeAiGuidance', () => {
  it('splits outcome averages between AI-guided and unguided riders', () => {
    const riders = new Set(['guided-1', 'guided-2', 'unguided-1', 'unguided-2']);
    const summary = summarizeAiGuidance({
      aiRequests: [
        { user_id: 'guided-1', status: 'ok' },
        { user_id: 'guided-2', status: 'ok_confidence_downgraded' },
        { user_id: 'unguided-1', status: 'error' },
        { user_id: 'unguided-2', status: 'pending' },
      ],
      outcomes: [
        { user_id: 'guided-1' },
        { user_id: 'guided-1' },
        { user_id: 'guided-1' },
        { user_id: 'guided-2' },
        { user_id: 'unguided-1' },
      ],
      riderIds: riders,
    });
    expect(summary.guidedRiders).toBe(2);
    expect(summary.unguidedRiders).toBe(2);
    expect(summary.guidedOutcomeAvg).toBe(2);
    expect(summary.unguidedOutcomeAvg).toBe(0.5);
  });

  it('keeps zero-outcome riders in the denominators and handles empty groups', () => {
    const summary = summarizeAiGuidance({
      aiRequests: [],
      outcomes: [{ user_id: RIDER }],
      riderIds: new Set([RIDER, OTHER_RIDER]),
    });
    expect(summary.guidedRiders).toBe(0);
    expect(summary.guidedOutcomeAvg).toBeNull();
    expect(summary.unguidedRiders).toBe(2);
    expect(summary.unguidedOutcomeAvg).toBe(0.5);
  });

  it('ignores riders outside the cohort', () => {
    const summary = summarizeAiGuidance({
      aiRequests: [{ user_id: OTHER_RIDER, status: 'ok' }],
      outcomes: [{ user_id: OTHER_RIDER }],
      riderIds: new Set([RIDER]),
    });
    expect(summary.guidedRiders).toBe(0);
    expect(summary.unguidedRiders).toBe(1);
    expect(summary.unguidedOutcomeAvg).toBe(0);
  });

  it('treats only ok statuses as guidance received', () => {
    expect(AI_SUCCESS_STATUSES.has('ok')).toBe(true);
    expect(AI_SUCCESS_STATUSES.has('ok_confidence_downgraded')).toBe(true);
    expect(AI_SUCCESS_STATUSES.has('completed_refusal_no_safe_answer')).toBe(false);
    expect(AI_SUCCESS_STATUSES.has('error')).toBe(false);
  });
});

describe('decideGate', () => {
  const passing = {
    acceptedRiders: 12,
    ridersWithLoop: 8,
    ridersWithRepeatLoops: 3,
    comparisonUsefulness: '4.2',
    veryDisappointedPct: 45,
  };

  it('passes when every target is met', () => {
    expect(decideGate(passing)).toBe(true);
  });

  it('gates on within-day loop completion', () => {
    expect(decideGate({ ...passing, ridersWithLoop: 7 })).toBe(false);
    expect(decideGate({ ...passing, ridersWithRepeatLoops: 2 })).toBe(false);
  });

  it('fails on missing survey data', () => {
    expect(decideGate({ ...passing, comparisonUsefulness: '—' })).toBe(false);
  });

  it('pins the published targets', () => {
    expect(GATE_TARGETS).toEqual({
      acceptedRiders: 12,
      ridersWithLoop: 8,
      ridersWithRepeatLoops: 3,
      comparisonUsefulness: 4,
      veryDisappointedPct: 40,
    });
  });
});
