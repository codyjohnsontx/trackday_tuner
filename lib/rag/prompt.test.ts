import { describe, expect, it } from 'vitest';
import {
  buildDayPlanPrompt,
  buildMessages,
  buildUserPrompt,
  collectDayPlanRiderText,
  DISCLAIMER_NOTE,
  ONE_CHANGE_NOTE,
  SYSTEM_PROMPT,
} from '@/lib/rag/prompt';
import type { RaceEngineerContext } from '@/lib/rag/race-engineer-context';
import type { KnowledgeChunk, RetrievedChunk } from '@/lib/rag/types';
import type { Session, SessionFeedback, Vehicle } from '@/types';

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

// The contract `collectDayPlanRiderText` exists to hold: every rider-authored
// string `buildDayPlanPrompt` puts in front of the model is screened. Stamping a
// distinct sentinel into each of those fields and asserting the two agree is the
// only form of this check that keeps working when someone adds a field - the
// alternative is a second hand-maintained list, which is the drift the collector
// was written to end. Fields excluded on purpose are named in its doc comment.
describe('collectDayPlanRiderText', () => {
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
  };

  function stampedSession(): Session {
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

  function stampedInput() {
    const stamped = stampedSession();
    const context: RaceEngineerContext = {
      similarSessions: [{ session: stamped, environment: null, score: 3, reasons: ['same track'] }],
      sessionEnvironment: null,
      recentFeedback: [stampedFeedback()],
      recentRecommendations: [],
      memory: {
        id: '44444444-4444-4444-4444-444444444444',
        user_id: 'user-1',
        vehicle_id: '11111111-1111-1111-1111-111111111111',
        track_id: null,
        summary: SENTINELS.memorySummary,
        patterns: null,
        evidence_count: 2,
        created_at: '2026-04-02T00:00:00Z',
        updated_at: '2026-04-02T00:00:00Z',
      },
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
