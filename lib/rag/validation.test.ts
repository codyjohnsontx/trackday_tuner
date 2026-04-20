import { describe, expect, it } from 'vitest';
import { validateTuningAdviceRequest } from '@/lib/rag/validation';

const validBody = {
  vehicle_id: '11111111-1111-1111-1111-111111111111',
  session_id: '22222222-2222-2222-2222-222222222222',
  question: 'Front pushes mid-corner after raising pressure 1 psi.',
  symptoms: ['understeer_mid_corner'],
  change_intent: 'stability_over_entry',
  temperature_c: 24,
};

describe('validateTuningAdviceRequest', () => {
  it('accepts a valid body', () => {
    const result = validateTuningAdviceRequest(validBody);
    expect(result.ok).toBe(true);
  });

  it('rejects non-object bodies', () => {
    expect(validateTuningAdviceRequest(null).ok).toBe(false);
    expect(validateTuningAdviceRequest('oops').ok).toBe(false);
    expect(validateTuningAdviceRequest([]).ok).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = validateTuningAdviceRequest({ ...validBody, secret: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Unknown field');
  });

  it('rejects short questions', () => {
    const result = validateTuningAdviceRequest({ ...validBody, question: 'short' });
    expect(result.ok).toBe(false);
  });

  it('rejects oversized questions', () => {
    const big = 'a'.repeat(1001);
    const result = validateTuningAdviceRequest({ ...validBody, question: big });
    expect(result.ok).toBe(false);
  });

  it('rejects too many symptoms', () => {
    const result = validateTuningAdviceRequest({
      ...validBody,
      symptoms: Array.from({ length: 9 }, (_, i) => `tag_${i}`),
    });
    expect(result.ok).toBe(false);
  });

  it('rejects invalid uuid', () => {
    const result = validateTuningAdviceRequest({ ...validBody, vehicle_id: 'not-a-uuid' });
    expect(result.ok).toBe(false);
  });

  it('strips empty symptoms and missing optionals', () => {
    const result = validateTuningAdviceRequest({
      vehicle_id: validBody.vehicle_id,
      session_id: validBody.session_id,
      question: validBody.question,
      symptoms: [' ', 'real_symptom'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.symptoms).toEqual(['real_symptom']);
      expect(result.data.change_intent).toBeUndefined();
      expect(result.data.temperature_c).toBeUndefined();
    }
  });

  it('rejects temperatures outside sane bounds', () => {
    expect(validateTuningAdviceRequest({ ...validBody, temperature_c: 999 }).ok).toBe(false);
    expect(validateTuningAdviceRequest({ ...validBody, temperature_c: -999 }).ok).toBe(false);
  });
});
