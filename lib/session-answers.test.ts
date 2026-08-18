import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_OUTCOME_OPTIONS,
  MISSING_CONDITIONS_MESSAGE,
  SESSION_CONDITION_OPTIONS,
  TIRE_CONDITION_OPTIONS,
  isSessionCondition,
  normalizeTireCondition,
} from '@/lib/session-answers';

describe('what counts as an answer', () => {
  it('treats an unanswered weather row as unanswered, not as sunny', () => {
    expect(isSessionCondition(null)).toBe(false);
    expect(isSessionCondition(undefined)).toBe(false);
    expect(isSessionCondition('')).toBe(false);
    expect(isSessionCondition('sunny')).toBe(true);
  });

  it('rejects a value that is not one of the four the column allows', () => {
    // `sessions_conditions_check` only admits these four.
    expect(isSessionCondition('drizzle')).toBe(false);
  });

  it('keeps an unanswered tire condition out of the stored setup', () => {
    expect(normalizeTireCondition(null)).toBeNull();
    expect(normalizeTireCondition(undefined)).toBeNull();
    expect(normalizeTireCondition('scrubbed')).toBe('scrubbed');
    expect(normalizeTireCondition('shredded')).toBeNull();
  });

  it('says why the weather is being asked for rather than just refusing', () => {
    expect(MISSING_CONDITIONS_MESSAGE).toMatch(/weather/i);
    expect(MISSING_CONDITIONS_MESSAGE.length).toBeGreaterThan(40);
  });

  it('offers every stored value as something the rider can pick', () => {
    expect(SESSION_CONDITION_OPTIONS.map((option) => option.value)).toEqual([
      'sunny',
      'overcast',
      'rainy',
      'mixed',
    ]);
    expect(TIRE_CONDITION_OPTIONS.map((option) => option.value)).toEqual([
      'new',
      'scrubbed',
      'used',
      'worn',
    ]);
    expect(FEEDBACK_OUTCOME_OPTIONS.map((option) => option.value)).toEqual([
      'better',
      'same',
      'worse',
      'unknown',
    ]);
  });
});
