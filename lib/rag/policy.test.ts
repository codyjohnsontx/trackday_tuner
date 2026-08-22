import { describe, expect, it } from 'vitest';
import type { AdviceResponse } from '@/lib/rag/schema';
import { evaluateAdvicePolicy } from '@/lib/rag/policy';

// The default summary describes rather than instructs. It used to read "Drop
// front pressure 0.5 psi.", which is an actionable delta, and every empty-plan
// test that did not override it was silently leaning on a splitter bug that tore
// "0.5" in half. A shared fixture must not carry an instruction it is not
// testing for.
function buildAdvice(overrides: Partial<AdviceResponse> = {}): AdviceResponse {
  return {
    summary: 'Front grip fell away mid-corner as the session went on.',
    recommended_changes: [
      {
        component: 'front_tire_pressure',
        direction: 'decrease',
        magnitude: '0.5 psi',
        reason: 'Recover front grip without a large setup swing.',
      },
    ],
    tradeoffs: ['Too large a drop can reduce steering precision.'],
    confidence: 'medium',
    safety_notes: [
      'This is informational only. You are responsible for vehicle safety and on-track conduct.',
      'Make one change at a time and re-test for a full session before stacking another change.',
    ],
    citations: [
      {
        source: 'docs/knowledge-base/tires/pressure-basics.md',
        snippet: 'Front pushing mid-corner after a pressure increase: drop 0.5 psi.',
      },
    ],
    prediction: {
      expected_effect: 'More front grip next session.',
      day_trend: 'No day trend was provided.',
      watch_items: ['front hot pressure'],
    },
    personal_evidence: [],
    data_used: {
      manual: true,
      weather: false,
      history: false,
      feedback: false,
      lap_data: false,
      telemetry: false,
    },
    refusal: null,
    ...overrides,
  };
}

describe('evaluateAdvicePolicy', () => {
  it('allows a grounded safe recommendation', () => {
    const result = evaluateAdvicePolicy({
      advice: buildAdvice(),
      fallbackDataUsed: buildAdvice().data_used,
    });
    expect(result.decision).toBe('allow');
    expect(result.violations).toEqual([]);
  });

  it('forces refusal for an unknown component', () => {
    const result = evaluateAdvicePolicy({
      advice: buildAdvice({
        recommended_changes: [
          {
            component: 'nitrous_button',
            direction: 'increase',
            magnitude: '3 stages',
            reason: 'Totally unsafe nonsense.',
          },
        ],
      }),
      fallbackDataUsed: buildAdvice().data_used,
    });
    expect(result.decision).toBe('force_refusal');
    expect(result.violations).toContain('unknown_component');
    expect(result.advice.recommended_changes).toEqual([]);
  });

  it('forces refusal for unsafe tire pressure magnitude', () => {
    const result = evaluateAdvicePolicy({
      advice: buildAdvice({
        recommended_changes: [
          {
            component: 'front_tire_pressure',
            direction: 'decrease',
            magnitude: '3 psi',
            reason: 'Too big to be safe.',
          },
        ],
      }),
      fallbackDataUsed: buildAdvice().data_used,
    });
    expect(result.decision).toBe('force_refusal');
    expect(result.violations).toContain('unsafe_magnitude');
  });

  it('forces refusal for ungrounded recommendations', () => {
    const result = evaluateAdvicePolicy({
      advice: buildAdvice({
        citations: [],
        personal_evidence: [],
      }),
      fallbackDataUsed: buildAdvice().data_used,
      validSessionIds: ['session-a'],
    });
    expect(result.decision).toBe('force_refusal');
    expect(result.violations).toContain('ungrounded_recommendation');
  });

  it('allows verified personal evidence to ground a recommendation', () => {
    const result = evaluateAdvicePolicy({
      advice: buildAdvice({
        citations: [],
        personal_evidence: [
          {
            label: 'Prior session',
            detail: 'This matched a previous front-push session.',
            source_session_id: 'session-a',
          },
        ],
      }),
      fallbackDataUsed: buildAdvice().data_used,
      validSessionIds: ['session-a'],
    });
    expect(result.decision).toBe('allow');
    expect(result.violations).toEqual([]);
  });

  it('forces refusal for personal evidence that references unknown sessions', () => {
    const result = evaluateAdvicePolicy({
      advice: buildAdvice({
        citations: [],
        personal_evidence: [
          {
            label: 'Fabricated session',
            detail: 'Claims a session that was not loaded.',
            source_session_id: 'unknown-session',
          },
        ],
      }),
      fallbackDataUsed: buildAdvice().data_used,
      validSessionIds: ['session-a'],
    });
    expect(result.decision).toBe('force_refusal');
    expect(result.violations).toContain('invalid_personal_evidence');
  });

  it('forces refusal when personal evidence references a session but no valid session ids are available', () => {
    const result = evaluateAdvicePolicy({
      advice: buildAdvice({
        citations: [],
        personal_evidence: [
          {
            label: 'Fabricated session',
            detail: 'Claims a session that was not loaded.',
            source_session_id: 'unknown-session',
          },
        ],
      }),
      fallbackDataUsed: buildAdvice().data_used,
      validSessionIds: [],
    });
    expect(result.decision).toBe('force_refusal');
    expect(result.violations).toContain('invalid_personal_evidence');
  });

  it('forces refusal with a distinct violation when no recommendations are generated', () => {
    const result = evaluateAdvicePolicy({
      advice: buildAdvice({
        recommended_changes: [],
      }),
      fallbackDataUsed: buildAdvice().data_used,
    });
    expect(result.decision).toBe('force_refusal');
    expect(result.violations).toContain('no_recommendation');
  });

  it('preserves an existing refusal when no recommendations are generated', () => {
    const result = evaluateAdvicePolicy({
      advice: buildAdvice({
        recommended_changes: [],
        refusal: 'This request is outside setup scope.',
      }),
      fallbackDataUsed: buildAdvice().data_used,
    });
    expect(result.decision).toBe('force_refusal');
    expect(result.violations).toContain('no_recommendation');
    expect(result.advice.refusal).toBe('This request is outside setup scope.');
    expect(result.advice.summary).toBe(
      'I could not identify a safe, supported setup recommendation from that request.',
    );
    expect(result.advice.recommended_changes).toEqual([]);
    expect(result.advice.tradeoffs).toEqual([]);
    expect(result.advice.confidence).toBe('low');
    expect(result.advice.citations).toEqual([]);
    expect(result.advice.personal_evidence).toEqual([]);
  });

  it('accepts plural magnitude units for supported components', () => {
    const result = evaluateAdvicePolicy({
      advice: buildAdvice({
        recommended_changes: [
          {
            component: 'rear_sprocket',
            direction: 'increase',
            magnitude: '2 teeth',
            reason: 'Shorten gearing slightly.',
          },
          {
            component: 'rear_wing_angle',
            direction: 'decrease',
            magnitude: '2 positions',
            reason: 'Trim drag a small amount.',
          },
          {
            component: 'front_camber',
            direction: 'decrease',
            magnitude: '0.5 degrees',
            reason: 'Reduce negative camber slightly.',
          },
        ],
      }),
      fallbackDataUsed: buildAdvice().data_used,
    });
    expect(result.decision).toBe('allow');
    expect(result.violations).toEqual([]);
  });

  it('accepts top-level component keys emitted by the model', () => {
    const result = evaluateAdvicePolicy({
      advice: buildAdvice({
        recommended_changes: [
          {
            component: 'tire_pressure',
            direction: 'decrease',
            magnitude: '0.5 psi',
            reason: 'Keep the change conservative.',
          },
        ],
      }),
      fallbackDataUsed: buildAdvice().data_used,
    });
    expect(result.decision).toBe('allow');
    expect(result.violations).toEqual([]);
  });

  it('downgrades unsupported high confidence', () => {
    const result = evaluateAdvicePolicy({
      advice: buildAdvice({
        confidence: 'high',
        citations: [
          {
            source: 'docs/knowledge-base/tires/pressure-basics.md',
            snippet: 'Front pushing mid-corner after a pressure increase: drop 0.5 psi.',
          },
        ],
        personal_evidence: [],
        data_used: {
          manual: true,
          weather: false,
          history: false,
          feedback: false,
          lap_data: false,
          telemetry: false,
        },
      }),
      fallbackDataUsed: buildAdvice().data_used,
    });
    expect(result.decision).toBe('downgrade_confidence');
    expect(result.violations).toContain('high_confidence_without_support');
    expect(result.advice.confidence).toBe('medium');
  });

  it('allows high confidence when citations and structured lap data provide support', () => {
    const advice = buildAdvice({
      confidence: 'high',
      personal_evidence: [],
      data_used: {
        manual: true,
        weather: false,
        history: false,
        feedback: false,
        lap_data: true,
        telemetry: false,
      },
    });
    const result = evaluateAdvicePolicy({
      advice,
      fallbackDataUsed: advice.data_used,
    });
    expect(result.decision).toBe('allow');
    expect(result.advice.confidence).toBe('high');
    expect(result.violations).toEqual([]);
  });

  it('forces refusal when refusal and changes both exist', () => {
    const result = evaluateAdvicePolicy({
      advice: buildAdvice({
        refusal: 'This is outside scope.',
      }),
      fallbackDataUsed: buildAdvice().data_used,
    });
    expect(result.decision).toBe('force_refusal');
    expect(result.violations).toContain('refusal_with_changes');
    expect(result.advice.refusal).toBe('This is outside scope.');
  });
});

describe('evaluateAdvicePolicy allowEmptyRecommendations', () => {
  it('still refuses an empty recommendation list by default', () => {
    const advice = buildAdvice({ recommended_changes: [] });
    const result = evaluateAdvicePolicy({ advice, fallbackDataUsed: advice.data_used });
    expect(result.decision).toBe('force_refusal');
    expect(result.violations).toContain('no_recommendation');
  });

  it('allows an empty, grounded plan when the caller opts in', () => {
    // A morning day plan whose right answer is "run your baseline first".
    const advice = buildAdvice({ recommended_changes: [] });
    const result = evaluateAdvicePolicy({
      advice,
      fallbackDataUsed: advice.data_used,
      allowEmptyRecommendations: true,
    });
    expect(result.decision).toBe('allow');
    expect(result.violations).toEqual([]);
    expect(result.advice.refusal).toBeNull();
  });

  it('still requires grounding when recommendations are allowed to be empty', () => {
    const advice = buildAdvice({ recommended_changes: [], citations: [] });
    const result = evaluateAdvicePolicy({
      advice,
      fallbackDataUsed: advice.data_used,
      allowEmptyRecommendations: true,
    });
    expect(result.decision).toBe('force_refusal');
    expect(result.violations).toContain('ungrounded_recommendation');
  });

  it('still honours an explicit model refusal when recommendations may be empty', () => {
    const advice = buildAdvice({
      recommended_changes: [],
      refusal: 'I cannot plan this day safely.',
    });
    const result = evaluateAdvicePolicy({
      advice,
      fallbackDataUsed: advice.data_used,
      allowEmptyRecommendations: true,
    });
    expect(result.decision).toBe('force_refusal');
    expect(result.advice.refusal).toBe('I cannot plan this day safely.');
  });

  it('still rejects unverifiable personal evidence when recommendations may be empty', () => {
    const advice = buildAdvice({
      recommended_changes: [],
      personal_evidence: [
        {
          label: 'Prior session',
          detail: 'You were quicker here last month.',
          source_session_id: 'not-a-session',
        },
      ],
    });
    const result = evaluateAdvicePolicy({
      advice,
      fallbackDataUsed: advice.data_used,
      allowEmptyRecommendations: true,
      validSessionIds: ['55555555-5555-5555-5555-555555555555'],
    });
    expect(result.decision).toBe('force_refusal');
    expect(result.violations).toContain('invalid_personal_evidence');
  });
});

describe('actionable prose in an empty plan', () => {
  function emptyPlan(overrides: Partial<AdviceResponse> = {}) {
    return evaluateAdvicePolicy({
      advice: buildAdvice({ recommended_changes: [], ...overrides }),
      fallbackDataUsed: buildAdvice().data_used,
      allowEmptyRecommendations: true,
    });
  }

  function decisionFor(summary: string) {
    return emptyPlan({ summary }).decision;
  }

  // Both walls are pinned here on purpose, because this guard has been moved in
  // both directions and each move broke the other side. Every sentence below is
  // one the guard once got wrong.
  //
  // THIS SET HAS A SHAPE, AND THE SHAPE IS A HAZARD. It grew case by case out of
  // phrasings that had already caused a failure, so it varies PHRASING well -
  // verbs, prepositions, clause order, articles, noun phrases - and it varied
  // everything else badly. For ten rounds every single case used an INTEGER
  // magnitude, which is exactly why a splitter that cut "0.5 psi" in half
  // survived all of them: no case could see it. Number format was the missed
  // dimension. The next person to extend this set will reach for whichever
  // dimension they happen to be thinking about and will inherit the same blind
  // spot, so before adding a case ask the harder question - WHICH DIMENSION AM I
  // NOT VARYING? Units, magnitude size, negative numbers, ranges, unicode
  // punctuation and sentence length are all still thin here.

  // WALL ONE - false negatives. A real setup instruction escaping into prose the
  // rider reads as advice, with no magnitude ceiling anywhere near it.
  describe('must refuse', () => {
    it.each([
      ['a delta the verb reaches across the component', 'Before session one, increase front tire pressure by 6 psi for more grip.'],
      ['a delta an article pushes out of a short window', 'Increase the front tire pressure by 1 psi before session one.'],
      ['a bare quantity the verb governs with no preposition', 'Drop the rear preload 4 turns and it will settle.'],
      ['a delta reached across a bare "and" inside one noun phrase', 'Increase the front and rear cold tire pressure by 1 psi.'],
      ['an instruction in the first clause of a comma-joined sentence', 'Soften front rebound 2 clicks, and check hot pressures after.'],
      ['a decimal delta, which a "." boundary used to tear in half', 'Before session one, drop front tire pressure by 0.5 psi.'],
      ['a decimal delta in a non-psi unit', 'Soften front rebound 1.5 clicks before session one.'],
      ['a delta reached across a canonical multi-word component', 'Increase front and rear cold pressure by 1 psi.'],
      ['a delta the verb governs directly', 'Soften front rebound 1 click before session one.'],
    ])('refuses %s', (_label, summary) => {
      expect(decisionFor(summary)).toBe('force_refusal');
      expect(emptyPlan({ summary }).violations).toContain('actionable_prose_without_changes');
    });
  });

  // WALL TWO - false refusals. A correct empty-changes day plan discarded whole,
  // which is the cost every widening of this pattern has charged.
  describe('must allow', () => {
    it.each([
      ['a baseline reading beside a noun "setting"', 'Start on your baseline 30 psi cold setting and check hot pressures after session one.'],
      ['a warming-day forecast naming a baseline pressure', 'Ambient will increase through the morning, so your 30 psi cold baseline will read higher hot.'],
      ['an observed delta reported before an unrelated forecast verb', 'Rear hot pressure came up by 2 psi over cold last time here, and ambient will increase again today.'],
      ['a reading reported without any instruction', 'Your last session finished at 32 psi hot on the rear.'],
      ['a forecast verb and a reported delta in separate clauses', 'Grip will drop as the track heats, and hot pressures typically come up by 2 psi from cold.'],
      ['a forecast whose second clause predicts a rise', 'Ambient will increase through the morning, so expect rear hot pressure to come up by 2 psi over cold.'],
      ['a decimal inside a reading rather than a delta', 'Your rear ran 26.5 psi hot last session, which is where it settled.'],
      ['a condition verb beside a non-setup unit', 'Expect grip to drop as ambient climbs past 30 degrees through the morning.'],
      ['a verb and a quantity in different sentences', 'Run the Session 3 baseline. Rear hot pressure was 26 psi that day.'],
    ])('allows %s', (_label, summary) => {
      expect(decisionFor(summary)).toBe('allow');
      expect(emptyPlan({ summary }).violations).toEqual([]);
    });
  });

  // ACCEPTED GAPS - allowed, and NOT because that is correct. Each is a real
  // instruction the guard does not catch, recorded rather than chased because
  // the guard is closed to further pattern work. A camber recommendation can
  // never be caught here: `degrees` is left out of the quantity pattern so a
  // temperature forecast is not read as a setup change, and camber's ceiling is
  // 0.5 degrees, so every legal camber change is invisible. The prompt contract
  // carries these, not this function.
  describe('known accepted gaps', () => {
    it.each([
      ['an instruction carrying no numeric delta', 'Front tyres want another half psi before session one.'],
      ['every legal camber recommendation, because degrees is not a setup unit', 'Reduce front camber by 0.5 degrees.'],
    ])('does not catch %s', (_label, summary) => {
      expect(decisionFor(summary)).toBe('allow');
    });
  });

  // A decimal point is not a sentence terminator. Pinned separately from the
  // cases above because it is a property of the splitter, not of any phrasing.
  it('does not treat a decimal point as a clause boundary', () => {
    expect(decisionFor('Drop front tire pressure by 0.5 psi.')).toBe('force_refusal');
    expect(decisionFor('Drop front tire pressure by 1 psi.')).toBe('force_refusal');
  });

  it('splits on comma-plus-connective but never on a bare "and"', () => {
    expect(decisionFor('Grip will drop as the track heats, and pressures come up by 2 psi.')).toBe(
      'allow',
    );
    expect(decisionFor('Increase the front and rear cold tire pressure by 1 psi.')).toBe(
      'force_refusal',
    );
  });

  // Order is what separates the two "by" sentences above: the refused one puts
  // the verb before the number, the allowed one reports the number first.
  it('reads the delta preposition as an instruction only after a change verb', () => {
    expect(decisionFor('Increase front tire pressure by 1 psi.')).toBe('force_refusal');
    expect(decisionFor('Front tire pressure rose by 1 psi.')).toBe('allow');
  });

  // The refusal only ever reaches the Morning Plan panel, which has no question
  // box - so it must not tell the rider to ask for something.
  it('refuses with copy the day-plan panel can act on', () => {
    const result = emptyPlan({ summary: 'Increase front pressure by 6 psi before session one.' });
    expect(result.advice.refusal).toContain('Try building the plan again');
    expect(result.advice.refusal).not.toContain('Ask for a specific change');
  });

  // Scope is the summary alone. The other prose fields are read as forecasts,
  // consequences and history rather than as the plan, and scanning them is
  // where every false refusal came from.
  it('reads the summary only, not tradeoffs, prediction or personal evidence', () => {
    expect(
      emptyPlan({
        prediction: {
          expected_effect: 'Stable.',
          day_trend: 'Warming.',
          watch_items: ['Rear hot pressure if it climbs by 2 psi'],
        },
      }).decision,
    ).toBe('allow');

    expect(emptyPlan({ tradeoffs: ['Adding 3 clicks of rebound would firm it up.'] }).decision).toBe(
      'allow',
    );

    expect(
      emptyPlan({
        personal_evidence: [
          {
            label: 'Session 3',
            detail: 'Your baseline setting of 30 psi worked well here.',
            source_session_id: null,
          },
        ],
      }).decision,
    ).toBe('allow');
  });

  it('leaves the normal path alone when changes are present', () => {
    // The prose check only guards the empty-plan path; a populated plan is
    // already validated change by change.
    const result = evaluateAdvicePolicy({
      advice: buildAdvice({ summary: 'Drop front pressure by 0.5 psi.' }),
      fallbackDataUsed: buildAdvice().data_used,
      allowEmptyRecommendations: true,
    });
    expect(result.decision).toBe('allow');
  });
});

