import { describe, expect, it } from 'vitest';
import { evaluateAdvicePolicy } from '@/lib/rag/policy';
import {
  buildDayPlanPrompt,
  buildUserPrompt,
  collectDayPlanSessionIds,
  collectTuningAdviceSessionIds,
} from '@/lib/rag/prompt';
import type { AdviceResponse } from '@/lib/rag/schema';
import type { RaceEngineerContext } from '@/lib/rag/race-engineer-context';
import type { AiRecommendation, Session, SessionFeedback, Vehicle } from '@/types';

/**
 * THE RACE ENGINEER REFUSED THE QUESTIONS IT SUGGESTED THE RIDER ASK.
 *
 * A rider asking "Front tire slid mid-corner after raising pressure 3 psi" was
 * answered with "I could not verify the historical session evidence referenced
 * in that response", followed by example questions of the same shape. That
 * message is `evaluateAdvicePolicy`'s `invalid_personal_evidence` branch, and it
 * was firing on the session the app had just handed the model.
 *
 * `formatSessionBlock` printed no `session_id`, so the current session, the
 * previous session and every day-plan recent session reached the model with no
 * id, while the allowed set was built from those very ids. Asked for personal
 * evidence about a session it had no id for, the model invented one - the
 * committed eval recording for `mc-gearing-slow-corner` cites the rider's own
 * session notes with `source_session_id: "null"` - and the guard discarded the
 * whole answer as fabricated. Nothing about the rider's account could avoid it:
 * the three blocks that DID print ids (`similar_sessions`, `recent_feedback`,
 * `recent_recommendations`) are all empty for a new rider.
 *
 * So the invariant is two-way, and each direction is its own defect:
 *   - an accepted id the prompt never printed is unusable, and asking the model
 *     to cite it produces a fabricated id and a refused answer;
 *   - a printed id the policy will not accept is bait for the same refusal.
 *
 * These tests build the prompt and the allowed set from ONE input, so the two
 * cannot drift apart again. The last test is the other half of the bar: the
 * guard must still refuse an id that was never shown.
 */

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const PREVIOUS_SESSION_ID = '22222222-2222-4222-8222-222222222222';
const SIMILAR_SESSION_ID = '33333333-3333-4333-8333-333333333333';
const FEEDBACK_SESSION_ID = '44444444-4444-4444-8444-444444444444';
const RECOMMENDATION_SESSION_ID = '55555555-5555-4555-8555-555555555555';
const OUTCOME_SESSION_ID = '66666666-6666-4666-8666-666666666666';
const NEVER_SHOWN_SESSION_ID = '99999999-9999-4999-8999-999999999999';

const VEHICLE: Vehicle = {
  id: 'vehicle-1',
  user_id: 'user-1',
  nickname: 'ZX-6R',
  type: 'motorcycle',
  year: 2019,
  make: 'Kawasaki',
  model: 'ZX-6R',
  photo_url: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function session(id: string, date: string, frontPressure: string): Session {
  return {
    id,
    user_id: 'user-1',
    vehicle_id: VEHICLE.id,
    track_id: null,
    track_name: 'Barber Motorsports Park',
    date,
    start_time: '11:20:00',
    session_number: 3,
    conditions: 'sunny',
    tires: {
      front: { brand: 'Pirelli', compound: 'SC2', pressure: frontPressure },
      rear: { brand: 'Pirelli', compound: 'SC1', pressure: '25.0 psi' },
      condition: 'scrubbed',
    },
    suspension: {
      front: { preload: '3 turns', compression: '8 clicks', rebound: '10 clicks', direction: 'in' },
      rear: { preload: '5 clicks', compression: '9 clicks', rebound: '11 clicks', direction: 'in' },
    },
    alignment: null,
    enabled_modules: null,
    extra_modules: null,
    notes: null,
    created_at: `${date}T12:00:00.000Z`,
    updated_at: `${date}T12:00:00.000Z`,
  };
}

const CURRENT = session(SESSION_ID, '2026-09-06', '32.5 psi');
const PREVIOUS = session(PREVIOUS_SESSION_ID, '2026-09-06', '29.5 psi');

const FEEDBACK = {
  id: 'feedback-1',
  user_id: 'user-1',
  session_id: FEEDBACK_SESSION_ID,
  outcome: 'better',
  rider_confidence: 4,
  symptoms: ['understeer_mid'],
  notes: 'Front held line after dropping a psi.',
  created_at: '2026-09-01T12:00:00.000Z',
  updated_at: '2026-09-01T12:00:00.000Z',
} as unknown as SessionFeedback;

const RECOMMENDATION = {
  id: 'recommendation-1',
  user_id: 'user-1',
  session_id: RECOMMENDATION_SESSION_ID,
  outcome_session_id: OUTCOME_SESSION_ID,
  status: 'applied',
  component: 'front_tire_pressure',
  direction: 'decrease',
  magnitude: '1 psi',
  predicted_effect: 'Front should hold a tighter line mid-corner.',
} as unknown as AiRecommendation;

/** The account shape that produced the captain's refusal: every id source populated. */
function context(): RaceEngineerContext {
  return {
    similarSessions: [
      {
        session: session(SIMILAR_SESSION_ID, '2026-08-15', '31.5 psi'),
        score: 0.82,
        reasons: ['same track', 'same compound'],
        environment: null,
      },
    ],
    sessionEnvironment: null,
    recentFeedback: [FEEDBACK],
    recentRecommendations: [RECOMMENDATION],
    memory: null,
    telemetrySummary: null,
    dayTrend: 'No environment snapshot is logged for this session.',
    dataUsed: {
      manual: true,
      weather: false,
      history: true,
      feedback: true,
      lap_data: false,
      telemetry: false,
    },
  };
}

const TUNING_INPUT = {
  session: CURRENT,
  previousSession: PREVIOUS,
  vehicle: VEHICLE,
  question: 'Front tire slid mid-corner after raising pressure 3 psi',
  symptoms: [],
  changeIntent: undefined,
  temperatureC: 24,
  raceEngineerContext: context(),
};

const DAY_PLAN_INPUT = {
  vehicle: VEHICLE,
  targetDate: '2026-09-07',
  trackName: 'Barber Motorsports Park',
  environment: null,
  recentSessions: [CURRENT, PREVIOUS],
  raceEngineerContext: context(),
};

/**
 * Every `session_id` the prompt prints. The lookbehind keeps
 * `outcome_session_id=` out of this set - it is collected separately below - and
 * the recommendation row's own `id=` is not a session id at all.
 */
function printedSessionIds(prompt: string): string[] {
  const ids = [...prompt.matchAll(/(?<![\w-])(?:outcome_)?session_id[:=] ?(\S+)/g)]
    .map((match) => match[1])
    .filter((value) => value !== '—');
  return [...new Set(ids)];
}

describe('the ids the prompt prints are the ids the policy accepts', () => {
  it('tuning-advice prints a session_id for every id it will accept, and accepts every one it prints', () => {
    const prompt = buildUserPrompt({ ...TUNING_INPUT, retrieved: [] });
    const accepted = collectTuningAdviceSessionIds(TUNING_INPUT);

    expect([...accepted].sort()).toEqual([...printedSessionIds(prompt)].sort());
  });

  it('day-plan prints a session_id for every id it will accept, and accepts every one it prints', () => {
    const prompt = buildDayPlanPrompt({ ...DAY_PLAN_INPUT, retrieved: [] });
    const accepted = collectDayPlanSessionIds(DAY_PLAN_INPUT);

    expect([...accepted].sort()).toEqual([...printedSessionIds(prompt)].sort());
  });

  it('prints the current and previous session ids the refusal was firing on', () => {
    const prompt = buildUserPrompt({ ...TUNING_INPUT, retrieved: [] });

    expect(prompt).toContain(`session_id: ${SESSION_ID}`);
    expect(prompt).toContain(`session_id: ${PREVIOUS_SESSION_ID}`);
    expect(collectTuningAdviceSessionIds(TUNING_INPUT)).toContain(PREVIOUS_SESSION_ID);
  });

  it('accepts nothing when the prompt has no session to print', () => {
    // A rider whose account is one session and nothing else - the shape that
    // could never produce a verifiable citation before.
    const bare = {
      ...TUNING_INPUT,
      previousSession: null,
      raceEngineerContext: null,
    };
    const prompt = buildUserPrompt({ ...bare, retrieved: [] });

    expect(collectTuningAdviceSessionIds(bare)).toEqual([SESSION_ID]);
    expect(printedSessionIds(prompt)).toEqual([SESSION_ID]);
  });
});

function adviceCiting(sourceSessionId: string | null): AdviceResponse {
  return {
    summary: 'Drop the front tire pressure back toward the baseline you were on.',
    recommended_changes: [
      {
        component: 'front_tire_pressure',
        direction: 'decrease',
        magnitude: '1 psi',
        reason: 'The front started sliding after the pressure went up.',
      },
    ],
    tradeoffs: [],
    confidence: 'medium',
    safety_notes: [
      'This is informational only. You are responsible for vehicle safety and on-track conduct.',
      'Make one change at a time and re-test for a full session before stacking another change.',
    ],
    citations: [
      {
        source: 'docs/knowledge-base/tires/pressure-basics.md',
        snippet: 'Cold pressure is the number you set; hot pressure is the number that matters.',
      },
    ],
    prediction: {
      expected_effect: 'The front should stop sliding mid-corner.',
      day_trend: 'No environment snapshot is logged for this session.',
      watch_items: ['Hot front pressure at the end of the session'],
    },
    personal_evidence: [
      {
        label: 'Session notes',
        detail: 'Front slid mid-corner after the pressure went up 3 psi.',
        source_session_id: sourceSessionId,
      },
    ],
    data_used: {
      manual: true,
      weather: true,
      history: true,
      feedback: true,
      lap_data: false,
      telemetry: false,
    },
    refusal: null,
  };
}

describe('invalid_personal_evidence after the ids are printed', () => {
  const accepted = collectTuningAdviceSessionIds(TUNING_INPUT);
  const fallbackDataUsed = {
    manual: true,
    weather: true,
    history: true,
    feedback: true,
    lap_data: false,
    telemetry: false,
  };

  it('answers the question the refusal screen tells the rider to ask', () => {
    // The whole headline: citing the session the app supplied is now a
    // verifiable citation rather than a discarded answer.
    const result = evaluateAdvicePolicy({
      advice: adviceCiting(SESSION_ID),
      fallbackDataUsed,
      validSessionIds: accepted,
    });

    expect(result.violations).not.toContain('invalid_personal_evidence');
    expect(result.advice.refusal).toBeNull();
    expect(result.advice.recommended_changes).toHaveLength(1);
  });

  it('accepts the previous session the prompt told the model to diagnose with', () => {
    const result = evaluateAdvicePolicy({
      advice: adviceCiting(PREVIOUS_SESSION_ID),
      fallbackDataUsed,
      validSessionIds: accepted,
    });

    expect(result.violations).not.toContain('invalid_personal_evidence');
    expect(result.advice.refusal).toBeNull();
  });

  it('STILL refuses an id that was never printed', () => {
    // The guard exists because an AI citing a track day that never happened, to
    // justify a change to a motorcycle's setup, is how a rider gets hurt.
    const result = evaluateAdvicePolicy({
      advice: adviceCiting(NEVER_SHOWN_SESSION_ID),
      fallbackDataUsed,
      validSessionIds: accepted,
    });

    expect(result.decision).toBe('force_refusal');
    expect(result.violations).toContain('invalid_personal_evidence');
    expect(result.advice.recommended_changes).toEqual([]);
  });

  it('STILL refuses the literal string "null" the model was recorded emitting', () => {
    // `tests/fixtures/rag-eval/recordings/completions.json` has the model
    // writing this into a field typed `string | null`. It is not a session id,
    // so it is fabrication as far as the guard can tell, and coercing it to
    // null would keep an unverified evidence entry in front of the rider.
    const result = evaluateAdvicePolicy({
      advice: adviceCiting('null'),
      fallbackDataUsed,
      validSessionIds: accepted,
    });

    expect(result.decision).toBe('force_refusal');
    expect(result.violations).toContain('invalid_personal_evidence');
  });
});
