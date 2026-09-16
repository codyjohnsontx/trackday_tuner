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

  it('normalizes legacy data_used objects that predate lap_data', () => {
    const result = parseAdviceResponse({
      ...validResponse,
      data_used: {
        manual: true,
        weather: false,
        history: false,
        feedback: false,
        telemetry: false,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.data_used.lap_data).toBe(false);
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

  it('accepts up to two recommended_changes (primary + secondary)', () => {
    const change = validResponse.recommended_changes[0];
    const result = parseAdviceResponse({
      ...validResponse,
      recommended_changes: [change, { ...change, component: 'secondary_check' }],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects more than two recommended_changes', () => {
    const change = validResponse.recommended_changes[0];
    const result = parseAdviceResponse({
      ...validResponse,
      recommended_changes: [
        change,
        { ...change, component: 'secondary_check' },
        { ...change, component: 'tertiary_check' },
      ],
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

/**
 * `source_session_id` is `string | null`, so the string "null" is a valid string
 * and reaches `evaluateAdvicePolicy` as a session id it cannot verify - which
 * force-refuses the whole response and costs the rider a good answer over the
 * model's own placeholder. The parser is where the two are told apart.
 *
 * `app/api/ai/tuning-advice/route.placeholder-session-id.test.ts` is the same
 * defect walked through the route with the recording that produced it.
 */
function evidence(sourceSessionId: unknown) {
  return {
    ...validResponse,
    personal_evidence: [
      {
        label: 'Session notes',
        detail: 'Second gear is too tall out of the slow left.',
        source_session_id: sourceSessionId,
      },
    ],
  };
}

function parsedReference(sourceSessionId: unknown) {
  const result = parseAdviceResponse(evidence(sourceSessionId));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.data.personal_evidence[0].source_session_id;
}

describe('parseAdviceResponse normalizes a placeholder session reference', () => {
  // "null" is the measured one - the 2026-09-08 recording of
  // `mc-gearing-slow-corner`. An empty reference is no reference at all.
  it.each(['null', 'NULL', ' null ', '', ' '])(
    'reads %j as no reference rather than as an unverifiable one',
    (placeholder) => {
      expect(parsedReference(placeholder)).toBeNull();
    },
  );

  it('keeps the evidence itself, so only the reference is dropped', () => {
    const result = parseAdviceResponse(evidence('null'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.personal_evidence).toHaveLength(1);
    expect(result.data.personal_evidence[0].detail).toBe(
      'Second gear is too tall out of the slow left.',
    );
  });

  it('leaves a real session id alone', () => {
    expect(parsedReference('33333333-3333-3333-3333-333333333333')).toBe(
      '33333333-3333-3333-3333-333333333333',
    );
  });

  // Declining to give a reference and inventing one are different acts, and only
  // the first is a placeholder. A fabricated id still reaches the policy and is
  // still refused - narrowing that here would hide fabrication, not placeholders.
  it('leaves a value that is not a placeholder alone, whatever its shape', () => {
    expect(parsedReference('the session from last month')).toBe('the session from last month');
    for (const unrecorded of ['undefined', 'none', 'None', 'nil']) {
      expect(parsedReference(unrecorded)).toBe(unrecorded);
    }
    expect(parsedReference('99999999-9999-4999-8999-999999999999')).toBe(
      '99999999-9999-4999-8999-999999999999',
    );
  });

  it('still rejects a non-string, non-null reference', () => {
    expect(parseAdviceResponse(evidence(42)).ok).toBe(false);
  });
});
