import { describe, expect, it } from 'vitest';
import { parseAdviceResponse } from '@/lib/rag/schema';

const validResponse = {
  summary: 'Front push after +1 psi is consistent with overheating the front.',
  recommended_changes: [
    {
      component: 'front_tire_pressure',
      direction: 'decrease',
      magnitude: '0.5 psi',
      reason: 'Reduce mid-corner push without losing initial bite.',
    },
  ],
  tradeoffs: ['Too large a drop can reduce steering precision.'],
  confidence: 'medium',
  safety_notes: ['Informational only.', 'One change at a time.'],
  citations: [
    { source: 'docs/knowledge-base/tires/pressure-basics.md', snippet: 'Lower pressure enlarges the contact patch...' },
  ],
  refusal: null,
};

describe('parseAdviceResponse', () => {
  it('accepts a well-formed response', () => {
    const result = parseAdviceResponse(validResponse);
    expect(result.ok).toBe(true);
  });

  it('defaults refusal to null if missing', () => {
    const noRefusal: Record<string, unknown> = { ...validResponse };
    delete noRefusal.refusal;
    const result = parseAdviceResponse(noRefusal);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.refusal).toBeNull();
  });

  it('rejects missing summary', () => {
    const broken: Record<string, unknown> = { ...validResponse };
    delete broken.summary;
    const result = parseAdviceResponse(broken);
    expect(result.ok).toBe(false);
  });

  it('rejects invalid confidence', () => {
    const result = parseAdviceResponse({ ...validResponse, confidence: 'extreme' });
    expect(result.ok).toBe(false);
  });

  it('rejects malformed recommended_changes', () => {
    const result = parseAdviceResponse({
      ...validResponse,
      recommended_changes: [{ component: 'x' }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects malformed citations', () => {
    const result = parseAdviceResponse({
      ...validResponse,
      citations: [{ source: 'x' }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(parseAdviceResponse(null).ok).toBe(false);
    expect(parseAdviceResponse('hello').ok).toBe(false);
    expect(parseAdviceResponse([]).ok).toBe(false);
  });

  it('accepts string refusal', () => {
    const result = parseAdviceResponse({
      ...validResponse,
      recommended_changes: [],
      refusal: 'Insufficient session data.',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.refusal).toBe('Insufficient session data.');
  });
});
