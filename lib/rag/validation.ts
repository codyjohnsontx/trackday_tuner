export interface TuningAdviceRequest {
  vehicle_id: string;
  session_id: string;
  question: string;
  symptoms?: string[];
  change_intent?: string;
  temperature_c?: number;
}

const ALLOWED_KEYS = new Set([
  'vehicle_id',
  'session_id',
  'question',
  'symptoms',
  'change_intent',
  'temperature_c',
]);

const MAX_QUESTION_LENGTH = 1000;
const MIN_QUESTION_LENGTH = 10;
const MAX_SYMPTOMS = 8;
const MAX_SYMPTOM_LENGTH = 64;
const MAX_CHANGE_INTENT_LENGTH = 128;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type ValidationResult =
  | { ok: true; data: TuningAdviceRequest }
  | { ok: false; error: string };

export function validateTuningAdviceRequest(input: unknown): ValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const record = input as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, error: `Unknown field: ${key}.` };
    }
  }

  const { vehicle_id, session_id, question } = record;

  if (typeof vehicle_id !== 'string' || !UUID_PATTERN.test(vehicle_id)) {
    return { ok: false, error: 'vehicle_id must be a UUID.' };
  }
  if (typeof session_id !== 'string' || !UUID_PATTERN.test(session_id)) {
    return { ok: false, error: 'session_id must be a UUID.' };
  }
  if (typeof question !== 'string') {
    return { ok: false, error: 'question must be a string.' };
  }
  const trimmedQuestion = question.trim();
  if (trimmedQuestion.length < MIN_QUESTION_LENGTH) {
    return {
      ok: false,
      error: `question must be at least ${MIN_QUESTION_LENGTH} characters.`,
    };
  }
  if (trimmedQuestion.length > MAX_QUESTION_LENGTH) {
    return {
      ok: false,
      error: `question must be at most ${MAX_QUESTION_LENGTH} characters.`,
    };
  }

  let symptoms: string[] | undefined;
  if (record.symptoms !== undefined) {
    if (!Array.isArray(record.symptoms)) {
      return { ok: false, error: 'symptoms must be an array of strings.' };
    }
    if (record.symptoms.length > MAX_SYMPTOMS) {
      return { ok: false, error: `symptoms cannot exceed ${MAX_SYMPTOMS} entries.` };
    }
    const cleaned: string[] = [];
    for (const entry of record.symptoms) {
      if (typeof entry !== 'string') {
        return { ok: false, error: 'symptoms must be strings.' };
      }
      const normalized = entry.trim();
      if (normalized.length === 0) continue;
      if (normalized.length > MAX_SYMPTOM_LENGTH) {
        return {
          ok: false,
          error: `symptoms entries must be at most ${MAX_SYMPTOM_LENGTH} characters.`,
        };
      }
      cleaned.push(normalized);
    }
    symptoms = cleaned;
  }

  let changeIntent: string | undefined;
  if (record.change_intent !== undefined) {
    if (typeof record.change_intent !== 'string') {
      return { ok: false, error: 'change_intent must be a string.' };
    }
    const trimmed = record.change_intent.trim();
    if (trimmed.length > MAX_CHANGE_INTENT_LENGTH) {
      return {
        ok: false,
        error: `change_intent must be at most ${MAX_CHANGE_INTENT_LENGTH} characters.`,
      };
    }
    if (trimmed.length > 0) changeIntent = trimmed;
  }

  let temperatureC: number | undefined;
  if (record.temperature_c !== undefined) {
    if (typeof record.temperature_c !== 'number' || Number.isNaN(record.temperature_c)) {
      return { ok: false, error: 'temperature_c must be a number.' };
    }
    if (record.temperature_c < -40 || record.temperature_c > 70) {
      return { ok: false, error: 'temperature_c must be between -40 and 70.' };
    }
    temperatureC = record.temperature_c;
  }

  return {
    ok: true,
    data: {
      vehicle_id,
      session_id,
      question: trimmedQuestion,
      symptoms,
      change_intent: changeIntent,
      temperature_c: temperatureC,
    },
  };
}

export const TUNING_ADVICE_LIMITS = {
  MAX_QUESTION_LENGTH,
  MIN_QUESTION_LENGTH,
  MAX_SYMPTOMS,
  MAX_SYMPTOM_LENGTH,
  MAX_CHANGE_INTENT_LENGTH,
  MAX_BODY_BYTES: 20 * 1024,
} as const;
