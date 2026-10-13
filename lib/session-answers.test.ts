import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_OUTCOME_OPTIONS,
  MISSING_CONDITIONS_MESSAGE,
  SESSION_CONDITION_OPTIONS,
  TIRE_CONDITION_OPTIONS,
  buildSessionOutcomeBody,
  isSessionCondition,
  normalizeTireCondition,
  parseRatingAnswer,
  ratingSelectValue,
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

describe('outcome ratings the rider never touched', () => {
  const answered = {
    referenceSessionId: 'ref',
    recommendationId: 'rec',
    outcome: 'better' as const,
    confidence: '',
    helpfulness: '',
    symptoms: [],
    notes: '',
  };

  it('sends an untouched confidence and usefulness as null, not as 3 and 4', () => {
    const body = buildSessionOutcomeBody(answered);
    expect(body.rider_confidence).toBeNull();
    expect(body.recommendation_helpfulness).toBeNull();
  });

  it('sends a rating the rider picked as that number', () => {
    const body = buildSessionOutcomeBody({ ...answered, confidence: '2', helpfulness: '5' });
    expect(body.rider_confidence).toBe(2);
    expect(body.recommendation_helpfulness).toBe(5);
  });

  it('drops usefulness when no recommendation is linked, whatever the select held', () => {
    const body = buildSessionOutcomeBody({ ...answered, recommendationId: '', helpfulness: '5' });
    expect(body.recommendation_id).toBeNull();
    expect(body.recommendation_helpfulness).toBeNull();
  });

  it('reads anything outside 1-5 as unrated', () => {
    expect(parseRatingAnswer('')).toBeNull();
    expect(parseRatingAnswer('0')).toBeNull();
    expect(parseRatingAnswer('6')).toBeNull();
    expect(parseRatingAnswer('2.5')).toBeNull();
    expect(parseRatingAnswer('3')).toBe(3);
  });

  it('reopens an unrated stored row unrated and a rated one on its rating', () => {
    expect(ratingSelectValue(null)).toBe('');
    expect(ratingSelectValue(undefined)).toBe('');
    expect(ratingSelectValue(4)).toBe('4');
  });
});
