export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export type AdviceConfidence = (typeof CONFIDENCE_LEVELS)[number];

export const MAX_RECOMMENDED_CHANGES = 2;

export interface RecommendedChange {
  component: string;
  direction: string;
  magnitude: string;
  reason: string;
}

export interface AdviceCitation {
  source: string;
  snippet: string;
}

export interface AdviceResponse {
  summary: string;
  recommended_changes: RecommendedChange[];
  tradeoffs: string[];
  confidence: AdviceConfidence;
  safety_notes: string[];
  citations: AdviceCitation[];
  refusal?: string | null;
}

export const adviceResponseJsonSchema = {
  name: 'AdviceResponse',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'summary',
      'recommended_changes',
      'tradeoffs',
      'confidence',
      'safety_notes',
      'citations',
      'refusal',
    ],
    properties: {
      summary: { type: 'string' },
      recommended_changes: {
        type: 'array',
        maxItems: MAX_RECOMMENDED_CHANGES,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['component', 'direction', 'magnitude', 'reason'],
          properties: {
            component: { type: 'string' },
            direction: { type: 'string' },
            magnitude: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
      tradeoffs: {
        type: 'array',
        items: { type: 'string' },
      },
      confidence: {
        type: 'string',
        enum: [...CONFIDENCE_LEVELS],
      },
      safety_notes: {
        type: 'array',
        items: { type: 'string' },
      },
      citations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['source', 'snippet'],
          properties: {
            source: { type: 'string' },
            snippet: { type: 'string' },
          },
        },
      },
      refusal: {
        type: ['string', 'null'],
      },
    },
  },
} as const;

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isConfidence(value: unknown): value is AdviceConfidence {
  return (
    typeof value === 'string' &&
    (CONFIDENCE_LEVELS as readonly string[]).includes(value)
  );
}

function isRecommendedChange(value: unknown): value is RecommendedChange {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    isString(v.component) &&
    isString(v.direction) &&
    isString(v.magnitude) &&
    isString(v.reason)
  );
}

function isCitation(value: unknown): value is AdviceCitation {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return isString(v.source) && isString(v.snippet);
}

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function parseAdviceResponse(value: unknown): ParseResult<AdviceResponse> {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'Response is not an object.' };
  }
  const v = value as Record<string, unknown>;

  if (!isString(v.summary)) return { ok: false, error: 'summary must be a string.' };
  if (!Array.isArray(v.recommended_changes) || !v.recommended_changes.every(isRecommendedChange)) {
    return { ok: false, error: 'recommended_changes must be an array of change objects.' };
  }
  if (v.recommended_changes.length > MAX_RECOMMENDED_CHANGES) {
    return {
      ok: false,
      error: `recommended_changes cannot exceed ${MAX_RECOMMENDED_CHANGES} entries (one primary plus at most one secondary check).`,
    };
  }
  if (!isStringArray(v.tradeoffs)) return { ok: false, error: 'tradeoffs must be an array of strings.' };
  if (!isConfidence(v.confidence)) {
    return { ok: false, error: `confidence must be one of ${CONFIDENCE_LEVELS.join(', ')}.` };
  }
  if (!isStringArray(v.safety_notes)) {
    return { ok: false, error: 'safety_notes must be an array of strings.' };
  }
  if (!Array.isArray(v.citations) || !v.citations.every(isCitation)) {
    return { ok: false, error: 'citations must be an array of citation objects.' };
  }
  if (v.refusal !== undefined && !isNullableString(v.refusal)) {
    return { ok: false, error: 'refusal must be a string or null.' };
  }

  return {
    ok: true,
    data: {
      summary: v.summary,
      recommended_changes: v.recommended_changes as RecommendedChange[],
      tradeoffs: v.tradeoffs,
      confidence: v.confidence,
      safety_notes: v.safety_notes,
      citations: v.citations as AdviceCitation[],
      refusal: (v.refusal ?? null) as string | null,
    },
  };
}
