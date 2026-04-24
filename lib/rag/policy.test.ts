import { describe, expect, it } from 'vitest';
import type { AdviceResponse } from '@/lib/rag/schema';
import { evaluateAdvicePolicy } from '@/lib/rag/policy';

function buildAdvice(overrides: Partial<AdviceResponse> = {}): AdviceResponse {
  return {
    summary: 'Drop front pressure 0.5 psi.',
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
          telemetry: false,
        },
      }),
      fallbackDataUsed: buildAdvice().data_used,
    });
    expect(result.decision).toBe('downgrade_confidence');
    expect(result.violations).toContain('high_confidence_without_support');
    expect(result.advice.confidence).toBe('medium');
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
