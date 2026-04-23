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

export interface AdvicePrediction {
  expected_effect: string;
  day_trend: string;
  watch_items: string[];
}

export interface PersonalEvidence {
  label: string;
  detail: string;
  source_session_id?: string | null;
}

export interface AdviceDataUsed {
  manual: boolean;
  weather: boolean;
  history: boolean;
  feedback: boolean;
  telemetry: boolean;
}

export interface AdviceResponse {
  summary: string;
  recommended_changes: RecommendedChange[];
  tradeoffs: string[];
  confidence: AdviceConfidence;
  safety_notes: string[];
  citations: AdviceCitation[];
  prediction: AdvicePrediction;
  personal_evidence: PersonalEvidence[];
  data_used: AdviceDataUsed;
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
      'prediction',
      'personal_evidence',
      'data_used',
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
      prediction: {
        type: 'object',
        additionalProperties: false,
        required: ['expected_effect', 'day_trend', 'watch_items'],
        properties: {
          expected_effect: { type: 'string' },
          day_trend: { type: 'string' },
          watch_items: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
      personal_evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'detail', 'source_session_id'],
          properties: {
            label: { type: 'string' },
            detail: { type: 'string' },
            source_session_id: { type: ['string', 'null'] },
          },
        },
      },
      data_used: {
        type: 'object',
        additionalProperties: false,
        required: ['manual', 'weather', 'history', 'feedback', 'telemetry'],
        properties: {
          manual: { type: 'boolean' },
          weather: { type: 'boolean' },
          history: { type: 'boolean' },
          feedback: { type: 'boolean' },
          telemetry: { type: 'boolean' },
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  if (keys.length !== required.length) return false;
  const expected = new Set(required);
  return keys.every((k) => expected.has(k));
}

const RECOMMENDED_CHANGE_KEYS = ['component', 'direction', 'magnitude', 'reason'] as const;
const CITATION_KEYS = ['source', 'snippet'] as const;
const PREDICTION_KEYS = ['expected_effect', 'day_trend', 'watch_items'] as const;
const PERSONAL_EVIDENCE_KEYS = ['label', 'detail', 'source_session_id'] as const;
const DATA_USED_KEYS = ['manual', 'weather', 'history', 'feedback', 'telemetry'] as const;

function isRecommendedChange(value: unknown): value is RecommendedChange {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, RECOMMENDED_CHANGE_KEYS)) return false;
  return (
    isString(value.component) &&
    isString(value.direction) &&
    isString(value.magnitude) &&
    isString(value.reason)
  );
}

function isCitation(value: unknown): value is AdviceCitation {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, CITATION_KEYS)) return false;
  return isString(value.source) && isString(value.snippet);
}

function isPrediction(value: unknown): value is AdvicePrediction {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, PREDICTION_KEYS)) return false;
  return (
    isString(value.expected_effect) &&
    isString(value.day_trend) &&
    isStringArray(value.watch_items)
  );
}

function isPersonalEvidence(value: unknown): value is PersonalEvidence {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, PERSONAL_EVIDENCE_KEYS)) return false;
  return (
    isString(value.label) &&
    isString(value.detail) &&
    isNullableString(value.source_session_id)
  );
}

function isAdviceDataUsed(value: unknown): value is AdviceDataUsed {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, DATA_USED_KEYS)) return false;
  return DATA_USED_KEYS.every((key) => typeof value[key] === 'boolean');
}

const EMPTY_PREDICTION: AdvicePrediction = {
  expected_effect: 'Treat this as a setup hypothesis and verify it in the next full session.',
  day_trend: 'No day trend was provided.',
  watch_items: [],
};

const EMPTY_DATA_USED: AdviceDataUsed = {
  manual: false,
  weather: false,
  history: false,
  feedback: false,
  telemetry: false,
};

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
  if (v.prediction !== undefined && !isPrediction(v.prediction)) {
    return { ok: false, error: 'prediction must be a valid prediction object.' };
  }
  if (
    v.personal_evidence !== undefined &&
    (!Array.isArray(v.personal_evidence) || !v.personal_evidence.every(isPersonalEvidence))
  ) {
    return { ok: false, error: 'personal_evidence must be an array of evidence objects.' };
  }
  if (v.data_used !== undefined && !isAdviceDataUsed(v.data_used)) {
    return { ok: false, error: 'data_used must be a valid data-used object.' };
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
      prediction: (v.prediction ?? EMPTY_PREDICTION) as AdvicePrediction,
      personal_evidence: (v.personal_evidence ?? []) as PersonalEvidence[],
      data_used: (v.data_used ?? EMPTY_DATA_USED) as AdviceDataUsed,
      refusal: (v.refusal ?? null) as string | null,
    },
  };
}
