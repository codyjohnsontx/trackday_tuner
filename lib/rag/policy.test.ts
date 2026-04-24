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
    });
    expect(result.decision).toBe('force_refusal');
    expect(result.violations).toContain('ungrounded_recommendation');
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
