import { describe, expect, it } from 'vitest';
import { demoDayPlanAdvice } from '@/components/ai/day-plan-panel';
import { demoTuningAdvice } from '@/components/ai/tuning-advice-panel';
import { evaluateAdvicePolicy } from '@/lib/rag/policy';
import type { AdviceResponse } from '@/lib/rag/schema';

/**
 * A demo that shows a rider a recommendation the policy would refuse is
 * advertising a product that does not exist. Both fixtures were guilty of it:
 * the day-plan demo said "Tire pressures" / "26 psi hot" and the tuning-advice
 * demo said "Front setup" / "33 psi hot front and 10-11 clicks rebound out",
 * neither of which survives evaluateAdvicePolicy.
 *
 * This imports the fixtures themselves rather than restating them, because a
 * hand-copied shape in a test drifts from the object the rider actually sees and
 * then agrees with whatever it was copied from.
 */
const CHANGE_LEVEL_VIOLATIONS = [
  'unknown_component',
  'unsupported_direction',
  'unsafe_magnitude',
] as const;

function evaluate(advice: AdviceResponse) {
  return evaluateAdvicePolicy({
    advice,
    fallbackDataUsed: advice.data_used,
    // The demo's own evidence rows are the sessions it claims, so the grounding
    // arm is satisfied the same way the live route satisfies it.
    validSessionIds: advice.personal_evidence.flatMap((entry) =>
      entry.source_session_id ? [entry.source_session_id] : [],
    ),
  });
}

describe.each([
  ['demoDayPlanAdvice', demoDayPlanAdvice],
  ['demoTuningAdvice', demoTuningAdvice],
])('%s', (_name, advice) => {
  it('recommends only changes the policy accepts', () => {
    const result = evaluate(advice);
    for (const violation of CHANGE_LEVEL_VIOLATIONS) {
      expect(result.violations).not.toContain(violation);
    }
  });

  it('survives the policy intact, so the rider sees what the demo promises', () => {
    const result = evaluate(advice);
    expect(result.decision).toBe('allow');
    expect(result.violations).toEqual([]);
    expect(result.advice.refusal).toBeNull();
    expect(result.advice.recommended_changes).toEqual(advice.recommended_changes);
  });
});
