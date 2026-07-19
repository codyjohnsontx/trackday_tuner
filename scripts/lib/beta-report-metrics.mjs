// Pure metric derivations for scripts/beta-report.mjs, kept separate so the
// join logic is unit-testable without live Supabase credentials.

export const GATE_TARGETS = {
  acceptedRiders: 12,
  ridersWithLoop: 8,
  ridersWithRepeatLoops: 3,
  comparisonUsefulness: 4,
  veryDisappointedPct: 40,
};

export const AI_SUCCESS_STATUSES = new Set(['ok', 'ok_confidence_downgraded']);

// Mirrors the within-day ordering enforced by save_session_outcome:
// (coalesce(start_time, '00:00'), created_at).
function compareSessionsWithinDay(a, b) {
  const aTime = a.start_time ?? '00:00';
  const bTime = b.start_time ?? '00:00';
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  const aCreated = a.created_at ?? '';
  const bCreated = b.created_at ?? '';
  return aCreated < bCreated ? -1 : aCreated > bCreated ? 1 : 0;
}

/**
 * Within-day loop: on one (rider, date), a session is logged, a setup change is
 * recorded (vs baseline or a prior session), a later session is logged, and an
 * outcome is saved on a non-first session at or after the change. An outcome
 * whose reference session resolves to a different date measures an across-day
 * comparison and does not complete a within-day loop.
 */
export function computeWithinDayLoops({ sessions, changes, outcomes, riderIds }) {
  const include = (userId) => !riderIds || riderIds.has(userId);
  const changedSessionIds = new Set(
    (changes ?? [])
      .filter((row) => include(row.user_id) && Array.isArray(row.changes) && row.changes.length > 0)
      .map((row) => row.session_id),
  );
  const dateBySessionId = new Map();
  const sessionsByRiderDate = new Map();
  for (const session of sessions ?? []) {
    if (!include(session.user_id)) continue;
    dateBySessionId.set(session.id, session.date);
    const key = `${session.user_id}|${session.date}`;
    const group = sessionsByRiderDate.get(key) ?? [];
    group.push(session);
    sessionsByRiderDate.set(key, group);
  }
  const outcomeBySessionId = new Map();
  for (const outcome of outcomes ?? []) {
    if (include(outcome.user_id)) outcomeBySessionId.set(outcome.session_id, outcome);
  }
  const loopsByRider = new Map();
  for (const [key, group] of sessionsByRiderDate) {
    const riderId = key.slice(0, key.indexOf('|'));
    if (!loopsByRider.has(riderId)) loopsByRider.set(riderId, 0);
    if (group.length < 2) continue;
    group.sort(compareSessionsWithinDay);
    let firstChangeIndex = Infinity;
    let loops = 0;
    group.forEach((session, index) => {
      if (changedSessionIds.has(session.id)) firstChangeIndex = Math.min(firstChangeIndex, index);
      const outcome = outcomeBySessionId.get(session.id);
      if (!outcome || index < 1 || firstChangeIndex > index) return;
      const referenceDate = outcome.reference_session_id
        ? dateBySessionId.get(outcome.reference_session_id)
        : undefined;
      if (referenceDate !== undefined && referenceDate !== session.date) return;
      loops += 1;
    });
    loopsByRider.set(riderId, loopsByRider.get(riderId) + loops);
  }
  const counts = [...loopsByRider.values()];
  return {
    loopsByRider,
    ridersWithLoop: counts.filter((count) => count >= 1).length,
    ridersWithRepeatLoops: counts.filter((count) => count >= 2).length,
    totalLoops: counts.reduce((sum, count) => sum + count, 0),
  };
}

/**
 * Count comparison_viewed events, grouped by the optional properties.surface
 * value so inline and dedicated-page views report separately once the app
 * stamps that distinction. Events without a surface bucket as 'unspecified'.
 */
export function summarizeComparisonUsage(events, riderIds) {
  const bySurface = new Map();
  let total = 0;
  for (const event of events ?? []) {
    if (event.event_name !== 'comparison_viewed') continue;
    if (riderIds && !riderIds.has(event.user_id)) continue;
    total += 1;
    const raw = event.properties?.surface;
    const surface = typeof raw === 'string' && raw.trim() ? raw.trim() : 'unspecified';
    bySurface.set(surface, (bySurface.get(surface) ?? 0) + 1);
  }
  return { total, bySurface };
}

/**
 * Join AI guidance to rider behavior on user_id: riders with at least one
 * successful ai_requests row are "guided"; compare outcomes recorded per rider
 * across the guided and unguided groups. Riders with zero outcomes stay in the
 * denominators so the averages reflect the whole cohort.
 */
export function summarizeAiGuidance({ aiRequests, outcomes, riderIds }) {
  const include = (userId) => !riderIds || riderIds.has(userId);
  const guided = new Set(
    (aiRequests ?? [])
      .filter((row) => include(row.user_id) && AI_SUCCESS_STATUSES.has(row.status))
      .map((row) => row.user_id),
  );
  const outcomeCounts = new Map();
  for (const outcome of outcomes ?? []) {
    if (!include(outcome.user_id)) continue;
    outcomeCounts.set(outcome.user_id, (outcomeCounts.get(outcome.user_id) ?? 0) + 1);
  }
  const riders = riderIds ? [...riderIds] : [...new Set([...guided, ...outcomeCounts.keys()])];
  let guidedOutcomes = 0;
  let unguidedOutcomes = 0;
  let unguidedRiders = 0;
  for (const rider of riders) {
    const count = outcomeCounts.get(rider) ?? 0;
    if (guided.has(rider)) guidedOutcomes += count;
    else {
      unguidedRiders += 1;
      unguidedOutcomes += count;
    }
  }
  return {
    guidedRiders: guided.size,
    unguidedRiders,
    guidedOutcomes,
    unguidedOutcomes,
    guidedOutcomeAvg: guided.size ? guidedOutcomes / guided.size : null,
    unguidedOutcomeAvg: unguidedRiders ? unguidedOutcomes / unguidedRiders : null,
  };
}

/**
 * The founding-beta gate. Within-day loop completion is primary; across-day
 * retention is reported as an observed signal and no longer gates the decision.
 */
export function decideGate({
  acceptedRiders,
  ridersWithLoop,
  ridersWithRepeatLoops,
  comparisonUsefulness,
  veryDisappointedPct,
}) {
  return (
    acceptedRiders >= GATE_TARGETS.acceptedRiders &&
    ridersWithLoop >= GATE_TARGETS.ridersWithLoop &&
    ridersWithRepeatLoops >= GATE_TARGETS.ridersWithRepeatLoops &&
    Number(comparisonUsefulness) >= GATE_TARGETS.comparisonUsefulness &&
    veryDisappointedPct >= GATE_TARGETS.veryDisappointedPct
  );
}
