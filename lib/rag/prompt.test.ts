import { describe, expect, it } from 'vitest';
import {
  buildDayPlanPrompt,
  buildMessages,
  buildUserPrompt,
  collectDayPlanRiderText,
  collectTuningAdviceRiderText,
  dropScreenedSources,
  DISCLAIMER_NOTE,
  ONE_CHANGE_NOTE,
  SYSTEM_PROMPT,
} from '@/lib/rag/prompt';
import { buildDayTrend, type RaceEngineerContext } from '@/lib/rag/race-engineer-context';
import type { KnowledgeChunk, RetrievedChunk } from '@/lib/rag/types';
import type {
  AiRecommendation,
  Session,
  SessionEnvironment,
  SessionFeedback,
  TelemetrySummary,
  Vehicle,
} from '@/types';

function vehicle(): Vehicle {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: 'user-1',
    nickname: 'R6 Track',
    type: 'motorcycle',
    year: 2020,
    make: 'Yamaha',
    model: 'YZF-R6',
    photo_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function session(partial: Partial<Session> = {}): Session {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    user_id: 'user-1',
    vehicle_id: '11111111-1111-1111-1111-111111111111',
    track_id: null,
    track_name: 'Thunderhill',
    date: '2026-04-01',
    start_time: '09:00:00',
    session_number: 2,
    conditions: 'sunny',
    tires: {
      front: { brand: 'Pirelli', compound: 'SC2', pressure: '30' },
      rear: { brand: 'Pirelli', compound: 'SC2', pressure: '25' },
      condition: 'scrubbed',
    },
    suspension: {
      front: { preload: '3', compression: '8', rebound: '10', direction: 'out' },
      rear: { preload: '4', compression: '9', rebound: '11', direction: 'out' },
    },
    alignment: null,
    enabled_modules: null,
    extra_modules: null,
    notes: 'Front pushed mid-corner.',
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...partial,
  };
}

function chunk(): KnowledgeChunk {
  return {
    id: 'docs/knowledge-base/tires/pressure-basics.md#01',
    source: 'docs/knowledge-base/tires/pressure-basics.md',
    heading: 'Common symptoms',
    vehicle_type: 'both',
    topic: 'tires',
    summary: null,
    text: 'Front pushing mid-corner after a pressure increase: drop 0.5 psi.',
    embedding: [],
  };
}

describe('buildUserPrompt', () => {
  const retrieved: RetrievedChunk[] = [{ chunk: chunk(), score: 0.87 }];

  it('includes the question, vehicle, current session, and knowledge snippets', () => {
    const prompt = buildUserPrompt({
      session: session(),
      previousSession: null,
      vehicle: vehicle(),
      question: 'Front pushes mid-corner after +1 psi.',
      symptoms: ['understeer_mid'],
      changeIntent: 'stability_over_entry',
      temperatureC: 24,
      retrieved,
    });
    expect(prompt).toContain('Front pushes mid-corner after +1 psi.');
    expect(prompt).toContain('type: motorcycle');
    expect(prompt).toContain('Thunderhill');
    expect(prompt).toContain('Previous session:\n  (none)');
    expect(prompt).toContain('docs/knowledge-base/tires/pressure-basics.md');
    expect(prompt).toContain(DISCLAIMER_NOTE);
    expect(prompt).toContain(ONE_CHANGE_NOTE);
    expect(prompt).toContain('Ambient temperature: 24 C');
  });

  it('renders a previous session block when provided', () => {
    const prompt = buildUserPrompt({
      session: session(),
      previousSession: session({ id: 'prev', date: '2026-03-01', notes: 'Good balance.' }),
      vehicle: vehicle(),
      question: 'Why did it get worse?',
      retrieved,
    });
    expect(prompt).toContain('Previous session:');
    expect(prompt).toContain('Good balance.');
    expect(prompt).not.toContain('Previous session:\n  (none)');
  });

  it('indicates when no knowledge matched', () => {
    const prompt = buildUserPrompt({
      session: session(),
      previousSession: null,
      vehicle: vehicle(),
      question: 'Give me a setup that wins championships.',
      retrieved: [],
    });
    expect(prompt).toContain('(none matched the query)');
  });
});

describe('buildMessages', () => {
  it('prefixes the system prompt', () => {
    const messages = buildMessages({
      session: session(),
      previousSession: null,
      vehicle: vehicle(),
      question: 'Front pushing mid-corner after +1 psi.',
      retrieved: [],
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe(SYSTEM_PROMPT);
    expect(messages[1].role).toBe('user');
  });
});

// The contract both collectors exist to hold: every rider-authored string a
// prompt builder puts in front of the model is screened. Stamping a distinct
// sentinel into each of those fields and asserting the two agree is the only
// form of this check that keeps working when someone adds a field - the
// alternative is a second hand-maintained list, which is the drift the
// collectors were written to end. Fields excluded on purpose are named in the
// exclusion list in lib/rag/prompt.ts, and the tuning-advice suite below
// asserts the submitted-field exclusions rather than just omitting them.
//
// The two suites share one sentinel table. A sentinel a given prompt does not
// print is skipped by that prompt's check, so telemetry, recommendations and the
// previous session cost the day-plan suite nothing.
const SENTINELS = {
  nickname: 'S-nickname',
  make: 'S-make',
  model: 'S-model',
  trackName: 'S-track',
  tyreCondition: 'S-tyre-condition',
  frontBrand: 'S-front-brand',
  frontCompound: 'S-front-compound',
  frontPressure: 'S-front-pressure',
  rearBrand: 'S-rear-brand',
  rearCompound: 'S-rear-compound',
  rearPressure: 'S-rear-pressure',
  frontPreload: 'S-front-preload',
  frontCompression: 'S-front-compression',
  frontRebound: 'S-front-rebound',
  frontDirection: 'S-front-direction',
  rearPreload: 'S-rear-preload',
  rearCompression: 'S-rear-compression',
  rearRebound: 'S-rear-rebound',
  rearDirection: 'S-rear-direction',
  frontCamber: 'S-front-camber',
  rearCamber: 'S-rear-camber',
  frontToe: 'S-front-toe',
  rearToe: 'S-rear-toe',
  caster: 'S-caster',
  sagFront: 'S-sag-front',
  sagRear: 'S-sag-rear',
  forkHeight: 'S-fork-height',
  rearRideHeight: 'S-rear-ride-height',
  frontSprocket: 'S-front-sprocket',
  rearSprocket: 'S-rear-sprocket',
  chainLength: 'S-chain-length',
  wingAngle: 'S-wing-angle',
  splitter: 'S-splitter',
  rake: 'S-rake',
  notes: 'S-notes',
  memorySummary: 'S-memory-summary',
  feedbackSymptom: 'S-feedback-symptom',
  feedbackNotes: 'S-feedback-notes',
  weather: 'S-weather',
  surface: 'S-surface',
  // Printed only by buildUserPrompt.
  previousNotes: 'S-previous-notes',
  telemetrySource: 'S-telemetry-source',
  telemetryText: 'S-telemetry-text',
  telemetryMetrics: 'S-telemetry-metrics',
  recommendationComponent: 'S-recommendation-component',
  recommendationDirection: 'S-recommendation-direction',
  recommendationMagnitude: 'S-recommendation-magnitude',
  recommendationEffect: 'S-recommendation-effect',
  // Submitted by the request rather than stored, so screen one owns them and
  // the tuning-advice collector deliberately leaves them out. Stamped anyway so
  // that exclusion is asserted rather than merely absent.
  question: 'S-question',
  symptom: 'S-symptom',
  changeIntent: 'S-change-intent',
};

function stampedSession(partial: Partial<Session> = {}): Session {
  return session({
    track_name: SENTINELS.trackName,
    tires: {
      front: {
        brand: SENTINELS.frontBrand,
        compound: SENTINELS.frontCompound,
        pressure: SENTINELS.frontPressure,
      },
      rear: {
        brand: SENTINELS.rearBrand,
        compound: SENTINELS.rearCompound,
        pressure: SENTINELS.rearPressure,
      },
      condition: SENTINELS.tyreCondition as Session['tires']['condition'],
    },
    suspension: {
      front: {
        preload: SENTINELS.frontPreload,
        compression: SENTINELS.frontCompression,
        rebound: SENTINELS.frontRebound,
        direction: SENTINELS.frontDirection as Session['suspension']['front']['direction'],
      },
      rear: {
        preload: SENTINELS.rearPreload,
        compression: SENTINELS.rearCompression,
        rebound: SENTINELS.rearRebound,
        direction: SENTINELS.rearDirection as Session['suspension']['rear']['direction'],
      },
    },
    alignment: {
      front_camber: SENTINELS.frontCamber,
      rear_camber: SENTINELS.rearCamber,
      front_toe: SENTINELS.frontToe,
      rear_toe: SENTINELS.rearToe,
      caster: SENTINELS.caster,
    },
    extra_modules: {
      geometry: {
        sag_front: SENTINELS.sagFront,
        sag_rear: SENTINELS.sagRear,
        fork_height: SENTINELS.forkHeight,
        rear_ride_height: SENTINELS.rearRideHeight,
      },
      drivetrain: {
        front_sprocket: SENTINELS.frontSprocket,
        rear_sprocket: SENTINELS.rearSprocket,
        chain_length: SENTINELS.chainLength,
      },
      aero: {
        wing_angle: SENTINELS.wingAngle,
        splitter_setting: SENTINELS.splitter,
        rake: SENTINELS.rake,
      },
    },
    notes: SENTINELS.notes,
    ...partial,
  });
}

function stampedFeedback(): SessionFeedback {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    user_id: 'user-1',
    session_id: '22222222-2222-2222-2222-222222222222',
    reference_session_id: null,
    vehicle_id: '11111111-1111-1111-1111-111111111111',
    track_id: null,
    recommendation_id: null,
    outcome: 'better',
    rider_confidence: 3,
    symptoms: [SENTINELS.feedbackSymptom],
    notes: SENTINELS.feedbackNotes,
    lap_time_delta_ms: null,
    recommendation_helpfulness: null,
    created_at: '2026-04-02T00:00:00Z',
    updated_at: '2026-04-02T00:00:00Z',
  };
}

function stampedMemory() {
  return {
    id: '44444444-4444-4444-4444-444444444444',
    user_id: 'user-1',
    vehicle_id: '11111111-1111-1111-1111-111111111111',
    track_id: null,
    summary: SENTINELS.memorySummary,
    patterns: null,
    evidence_count: 2,
    created_at: '2026-04-02T00:00:00Z',
    updated_at: '2026-04-02T00:00:00Z',
  };
}

describe('collectDayPlanRiderText', () => {
  function stampedInput() {
    const stamped = stampedSession();
    const context: RaceEngineerContext = {
      similarSessions: [{ session: stamped, environment: null, score: 3, reasons: ['same track'] }],
      sessionEnvironment: null,
      recentFeedback: [stampedFeedback()],
      recentRecommendations: [],
      memory: stampedMemory(),
      telemetrySummary: null,
      dayTrend: 'Warming through the morning.',
      dataUsed: {
        manual: true,
        weather: true,
        history: true,
        feedback: true,
        lap_data: false,
        telemetry: false,
      },
    };

    return {
      vehicle: {
        ...vehicle(),
        nickname: SENTINELS.nickname,
        make: SENTINELS.make,
        model: SENTINELS.model,
      },
      targetDate: '2026-04-05',
      trackName: SENTINELS.trackName,
      environment: {
        ambient_temperature_c: 21,
        track_temperature_c: 33,
        humidity_percent: 40,
        weather_condition: SENTINELS.weather,
        surface_condition: SENTINELS.surface,
        source: 'manual' as const,
      },
      recentSessions: [stamped],
      raceEngineerContext: context,
    };
  }

  it('collects every rider-authored string the day-plan prompt prints', () => {
    const input = stampedInput();
    const prompt = buildDayPlanPrompt({ ...input, retrieved: [] });
    const collected = collectDayPlanRiderText(input);

    const missing = Object.entries(SENTINELS)
      .filter(([, sentinel]) => prompt.includes(sentinel))
      .filter(([, sentinel]) => !collected.some((field) => field.value.includes(sentinel)))
      .map(([name]) => name);

    expect(missing).toEqual([]);
    // Guard the guard: if the prompt stopped printing these the check above
    // would pass vacuously.
    expect(prompt).toContain(SENTINELS.tyreCondition);
    expect(prompt).toContain(SENTINELS.frontDirection);
    expect(prompt).toContain(SENTINELS.feedbackNotes);
    expect(prompt).toContain(SENTINELS.memorySummary);
  });

  // The environment on this route is what the rider just typed into the planner
  // - `buildContext` copies the submitted values into `sessionEnvironment` - so
  // a refusal names a box they are looking at. The same two columns skip on
  // tuning-advice, where they are the stored row. Getting this backwards would
  // silently drop submitted text from the plan.
  it('refuses on the environment it was handed, which the request just submitted', () => {
    const collected = collectDayPlanRiderText(stampedInput());
    const weather = collected.filter((field) => field.value.includes(SENTINELS.weather));

    expect(weather.length).toBeGreaterThan(0);
    expect(weather.every((field) => field.onMatch === 'refuse')).toBe(true);
  });

  // Nothing this route collects can be skipped. Its recommendation list is
  // always empty and its environment is submitted, so `dropScreenedSources` can
  // never fire here - which is what keeps day-plan's behaviour where it was.
  it('collects nothing skippable, so the drop path is inert on this route', () => {
    const collected = collectDayPlanRiderText(stampedInput());

    expect(collected.length).toBeGreaterThan(0);
    expect(collected.filter((field) => field.onMatch === 'skip')).toEqual([]);
  });

  it('labels each value with something the rider can go and edit', () => {
    const collected = collectDayPlanRiderText(stampedInput());
    const labelFor = (sentinel: string) =>
      collected.find((field) => field.value.includes(sentinel))?.label;

    expect(labelFor(SENTINELS.nickname)).toBe('the vehicle nickname');
    expect(labelFor(SENTINELS.notes)).toBe('the notes on your 2026-04-01 session');
    expect(labelFor(SENTINELS.tyreCondition)).toBe('the tyre condition on your 2026-04-01 session');
    expect(labelFor(SENTINELS.feedbackNotes)).toBe(
      'the notes on the outcome you logged on 2026-04-02',
    );
  });
});

describe('collectTuningAdviceRiderText', () => {
  // Submitted rather than stored. `classifyRaceEngineerQuestion` screens all
  // three against a strict superset of the stored-text patterns before the route
  // ever gets here, so collecting them would move a submitted-text refusal onto
  // the audit status the throttle does not count.
  const SUBMITTED = ['question', 'symptom', 'changeIntent'];

  function stampedInput() {
    const current = stampedSession();
    const context: RaceEngineerContext = {
      similarSessions: [
        { session: current, environment: null, score: 3, reasons: ['same track'] },
      ],
      sessionEnvironment: {
        id: '55555555-5555-5555-5555-555555555555',
        user_id: 'user-1',
        session_id: '22222222-2222-2222-2222-222222222222',
        ambient_temperature_c: 21,
        track_temperature_c: 33,
        humidity_percent: 40,
        weather_condition: SENTINELS.weather,
        surface_condition: SENTINELS.surface,
        source: 'manual',
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-01T00:00:00Z',
      } as SessionEnvironment,
      recentFeedback: [stampedFeedback()],
      recentRecommendations: [
        {
          id: '66666666-6666-6666-6666-666666666666',
          user_id: 'user-1',
          session_id: '22222222-2222-2222-2222-222222222222',
          vehicle_id: '11111111-1111-1111-1111-111111111111',
          track_id: null,
          request_id: 'earlier',
          summary: 'Earlier recommendation.',
          component: SENTINELS.recommendationComponent,
          direction: SENTINELS.recommendationDirection,
          magnitude: SENTINELS.recommendationMagnitude,
          predicted_effect: SENTINELS.recommendationEffect,
          status: 'applied',
          advice: {},
          context_snapshot: {},
          outcome_session_id: null,
          created_at: '2026-03-20T00:00:00Z',
          updated_at: '2026-03-20T00:00:00Z',
        } as AiRecommendation,
      ],
      memory: stampedMemory(),
      telemetrySummary: {
        id: '77777777-7777-7777-7777-777777777777',
        user_id: 'user-1',
        session_id: '22222222-2222-2222-2222-222222222222',
        vehicle_id: '11111111-1111-1111-1111-111111111111',
        source: SENTINELS.telemetrySource,
        summary: SENTINELS.telemetryText,
        metrics: { note: SENTINELS.telemetryMetrics },
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-01T00:00:00Z',
      } as TelemetrySummary,
      dayTrend: 'Warming through the morning.',
      dataUsed: {
        manual: true,
        weather: true,
        history: true,
        feedback: true,
        lap_data: false,
        telemetry: true,
      },
    };

    return {
      session: current,
      previousSession: session({
        id: 'prev',
        date: '2026-03-01',
        notes: SENTINELS.previousNotes,
      }),
      vehicle: {
        ...vehicle(),
        nickname: SENTINELS.nickname,
        make: SENTINELS.make,
        model: SENTINELS.model,
      },
      question: SENTINELS.question,
      symptoms: [SENTINELS.symptom],
      changeIntent: SENTINELS.changeIntent,
      temperatureC: 24,
      raceEngineerContext: context,
    };
  }

  it('collects every stored rider-authored string the tuning-advice prompt prints', () => {
    const input = stampedInput();
    const prompt = buildUserPrompt({ ...input, retrieved: [] });
    const collected = collectTuningAdviceRiderText(input);

    const missing = Object.entries(SENTINELS)
      .filter(([name]) => !SUBMITTED.includes(name))
      .filter(([, sentinel]) => prompt.includes(sentinel))
      .filter(([, sentinel]) => !collected.some((field) => field.value.includes(sentinel)))
      .map(([name]) => name);

    expect(missing).toEqual([]);
    // Guard the guard: every one of these was in the prompt and screened by
    // nothing before this collector existed, so a check that passed because the
    // prompt stopped printing them would be worthless.
    expect(prompt).toContain(SENTINELS.notes);
    expect(prompt).toContain(SENTINELS.previousNotes);
    expect(prompt).toContain(SENTINELS.nickname);
    expect(prompt).toContain(SENTINELS.memorySummary);
    expect(prompt).toContain(SENTINELS.feedbackNotes);
    expect(prompt).toContain(SENTINELS.telemetryMetrics);
    expect(prompt).toContain(SENTINELS.recommendationEffect);
    expect(prompt).toContain(SENTINELS.weather);
  });

  it('leaves the submitted fields to the first screen', () => {
    const input = stampedInput();
    const prompt = buildUserPrompt({ ...input, retrieved: [] });
    const collected = collectTuningAdviceRiderText(input);

    for (const name of SUBMITTED) {
      const sentinel = SENTINELS[name as keyof typeof SENTINELS];
      expect(prompt).toContain(sentinel);
      expect(collected.some((field) => field.value.includes(sentinel))).toBe(false);
    }
  });

  // REFUSE what the rider can go and fix; SKIP what they cannot reach. The route
  // can only act on that if the collector says which is which, and a skip has to
  // name a source precise enough to remove from the prompt.
  it('gives each value a disposition and names what a skip drops', () => {
    const collected = collectTuningAdviceRiderText(stampedInput());
    const fieldFor = (sentinel: string) =>
      collected.find((field) => field.value.includes(sentinel));

    // Reachable: the session form, the garage form, the outcome panel, and
    // `replaceSessionLaps` for the telemetry row.
    expect(fieldFor(SENTINELS.notes)).toMatchObject({ onMatch: 'refuse' });
    expect(fieldFor(SENTINELS.nickname)).toMatchObject({ onMatch: 'refuse' });
    expect(fieldFor(SENTINELS.feedbackNotes)).toMatchObject({ onMatch: 'refuse' });
    expect(fieldFor(SENTINELS.telemetryMetrics)).toMatchObject({ onMatch: 'refuse' });

    // Reachable through the outcome panel, because `save_session_outcome`
    // overwrites this summary rather than appending to it - so it refuses, and
    // the label has to name the outcome rather than the memory row.
    expect(fieldFor(SENTINELS.memorySummary)).toMatchObject({
      onMatch: 'refuse',
      label: 'the notes on the outcome you logged on 2026-04-02',
    });

    // The stored `session_environment` row, written only by `createSession`.
    // The same two columns refuse on day-plan, where the rider just typed them.
    expect(fieldFor(SENTINELS.weather)).toMatchObject({
      onMatch: 'skip',
      source: { kind: 'sessionEnvironment' },
    });
    expect(fieldFor(SENTINELS.surface)).toMatchObject({
      onMatch: 'skip',
      source: { kind: 'sessionEnvironment' },
    });

    for (const sentinel of [
      SENTINELS.recommendationComponent,
      SENTINELS.recommendationDirection,
      SENTINELS.recommendationMagnitude,
      SENTINELS.recommendationEffect,
    ]) {
      expect(fieldFor(sentinel)).toMatchObject({
        onMatch: 'skip',
        source: { kind: 'recommendation', id: '66666666-6666-6666-6666-666666666666' },
      });
    }

    // Nothing else may skip: a skip on a field the rider can reach is a silent
    // hole, not a convenience.
    expect(
      new Set(
        collected.filter((field) => field.onMatch === 'skip').map((field) => field.label),
      ),
    ).toEqual(
      new Set([
        'the weather condition on your 2026-04-01 session',
        'the surface condition on your 2026-04-01 session',
        'the saved recommendation from 2026-03-20',
      ]),
    );
  });

  it('labels each value with something the rider can go and find', () => {
    const collected = collectTuningAdviceRiderText(stampedInput());
    const labelFor = (sentinel: string) =>
      collected.find((field) => field.value.includes(sentinel))?.label;

    expect(labelFor(SENTINELS.nickname)).toBe('the vehicle nickname');
    expect(labelFor(SENTINELS.notes)).toBe('the notes on your 2026-04-01 session');
    expect(labelFor(SENTINELS.previousNotes)).toBe('the notes on your 2026-03-01 session');
    expect(labelFor(SENTINELS.feedbackNotes)).toBe(
      'the notes on the outcome you logged on 2026-04-02',
    );
    // The stored session_environment row, not anything typed into a planner.
    expect(labelFor(SENTINELS.weather)).toBe('the weather condition on your 2026-04-01 session');
    expect(labelFor(SENTINELS.recommendationEffect)).toBe(
      'the saved recommendation from 2026-03-20',
    );
    expect(labelFor(SENTINELS.telemetryMetrics)).toBe('the telemetry metrics');
  });
});

// Skipping is only worth anything if the value actually leaves the prompt, so
// this is the half of the guard that has to be exact. The two failure modes it
// is written against are a drop that silently removes nothing, and a drop that
// frees a slot in the printed window for a row nothing screened.
describe('dropScreenedSources', () => {
  function recommendation(id: string, createdAt = '2026-03-20T00:00:00Z'): AiRecommendation {
    return {
      id,
      user_id: 'user-1',
      session_id: '22222222-2222-2222-2222-222222222222',
      vehicle_id: '11111111-1111-1111-1111-111111111111',
      track_id: null,
      request_id: 'earlier',
      summary: 'Earlier recommendation.',
      component: 'front_rebound',
      direction: 'soften',
      magnitude: '1 click',
      predicted_effect: 'less push on entry',
      status: 'applied',
      advice: {},
      context_snapshot: {},
      outcome_session_id: null,
      created_at: createdAt,
      updated_at: createdAt,
    } as AiRecommendation;
  }

  function context(partial: Partial<RaceEngineerContext> = {}): RaceEngineerContext {
    return {
      similarSessions: [],
      sessionEnvironment: {
        id: '55555555-5555-5555-5555-555555555555',
        user_id: 'user-1',
        session_id: '22222222-2222-2222-2222-222222222222',
        ambient_temperature_c: 21,
        track_temperature_c: 33,
        humidity_percent: 40,
        weather_condition: 'overcast',
        surface_condition: 'dry',
        source: 'manual',
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-01T00:00:00Z',
      } as SessionEnvironment,
      recentFeedback: [],
      recentRecommendations: [],
      memory: stampedMemory(),
      telemetrySummary: null,
      // What `buildDayTrend` returns for the environment above, because the
      // point of these cases is that the trend moves when the row is dropped.
      dayTrend:
        'Track temperature is logged, so use hot pressure and grip change as primary day-trend checks.',
      dataUsed: {
        manual: true,
        weather: true,
        history: false,
        feedback: false,
        lap_data: false,
        telemetry: false,
      },
      ...partial,
    };
  }

  const CURRENT = session({ date: '2026-04-01', start_time: '09:00:00' });

  it('returns the context untouched when nothing was dropped', () => {
    const input = context();
    expect(dropScreenedSources(input, [], CURRENT)).toBe(input);
  });

  // Everything derived from the environment has to move with it. Left alone the
  // prompt would say the environment is absent, that no weather data was used,
  // and that the track temperature is logged - three statements about the same
  // withheld row that contradict each other.
  it('drops the session environment and everything derived from it', () => {
    const before = context();
    expect(before.dayTrend).toContain('Track temperature is logged');

    const result = dropScreenedSources(before, [{ kind: 'sessionEnvironment' }], CURRENT);

    expect(result.sessionEnvironment).toBeNull();
    expect(result.dataUsed.weather).toBe(false);
    expect(result.dataUsed.manual).toBe(true);
    // Recomputed through `buildDayTrend`, so it is exactly what the loader would
    // have produced had the row never existed rather than a string written here.
    expect(result.dayTrend).toBe(buildDayTrend(CURRENT, null, before.similarSessions));
    expect(result.dayTrend).not.toContain('Track temperature is logged');
  });

  it('leaves the day trend alone when the environment survives', () => {
    const before = context({
      recentRecommendations: [recommendation('a'), recommendation('b')],
    });
    const result = dropScreenedSources(before, [{ kind: 'recommendation', id: 'a' }], CURRENT);

    expect(result.dayTrend).toBe(before.dayTrend);
    expect(result.sessionEnvironment).not.toBeNull();
    expect(result.dataUsed.weather).toBe(true);
  });

  it('drops exactly the named recommendation', () => {
    const result = dropScreenedSources(
      context({ recentRecommendations: [recommendation('a'), recommendation('b')] }),
      [{ kind: 'recommendation', id: 'a' }],
      CURRENT,
    );
    expect(result.recentRecommendations.map((row) => row.id)).toEqual(['b']);
  });

  // The context loader reads five rows and the prompt prints three, so filtering
  // the full list would slide row four - which the collector never screened -
  // into the window the drop just freed.
  it('never promotes a row the collector did not screen', () => {
    const result = dropScreenedSources(
      context({
        recentRecommendations: ['a', 'b', 'c', 'd', 'e'].map((id) => recommendation(id)),
      }),
      [{ kind: 'recommendation', id: 'a' }],
      CURRENT,
    );
    expect(result.recentRecommendations.map((row) => row.id)).toEqual(['b', 'c']);
  });

  // Fail closed. A drop that matched nothing means the caller screened one
  // object and is about to prompt from another, which is the case the doc on
  // `droppedSources` calls worse than the refusal it replaced.
  it('throws rather than silently dropping nothing', () => {
    expect(() =>
      dropScreenedSources(
        context({ sessionEnvironment: null }),
        [{ kind: 'sessionEnvironment' }],
        CURRENT,
      ),
    ).toThrow();
    expect(() =>
      dropScreenedSources(
        context({ recentRecommendations: [recommendation('a')] }),
        [{ kind: 'recommendation', id: 'not-in-the-window' }],
        CURRENT,
      ),
    ).toThrow();
  });

  // A row past the printed window was never screened, so asking to drop it means
  // the caller is working from a different window than the collector was.
  it('throws when asked to drop a row outside the screened window', () => {
    expect(() =>
      dropScreenedSources(
        context({ recentRecommendations: ['a', 'b', 'c', 'd'].map((id) => recommendation(id)) }),
        [{ kind: 'recommendation', id: 'd' }],
        CURRENT,
      ),
    ).toThrow();
  });
});
