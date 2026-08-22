import {
  buildPromptFingerprint,
  buildPromptRedactedPreview,
} from '@/lib/ai-observability';
import {
  getAiRequestFingerprintSecret,
  getAiRateLimitPerHour,
  getAiRateLimitPerMinute,
} from '@/lib/env.server';
import {
  countRequestsSince,
  isRefusalThrottled,
  reservePendingSlot,
  updateRequestLog,
} from '@/lib/rag/ai-request-log';
import { AI_REQUEST_MAX_BODY_BYTES } from '@/lib/rag/validation';

/**
 * The guard pipeline every AI route runs before it talks to the model: read a
 * bounded body, throttle a rider who keeps tripping the refusal path, reserve
 * an `ai_requests` slot, then count the reserved rows against the per-rider
 * limits.
 *
 * This lives in one place because it is safety code. Two copies drift, and they
 * drift silently in the direction of whichever copy nobody is reading - a
 * change to the throttle window, a retry-after value, or the reserve-then-count
 * ordering has to reach both routes or one of them is quietly weaker.
 * `app/api/ai/tuning-advice/route.characterization.test.ts` locks the observable
 * behaviour of this pipeline so a future edit cannot move it unnoticed.
 */

export interface AiRequestFailure {
  status: number;
  error: string;
  headers: Record<string, string>;
}

export type AiBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; failure: AiRequestFailure };

export type AiPreflightResult =
  | { ok: true; promptFingerprint: string }
  | { ok: false; failure: AiRequestFailure };

function failure(status: number, error: string, headers: Record<string, string> = {}): AiRequestFailure {
  return { status, error, headers };
}

/**
 * Reads the request body under the shared size ceiling. The declared
 * content-length is checked first as a cheap reject, then the decoded bytes,
 * because the header is caller-supplied and may lie.
 */
export async function readAiRequestBody(request: Request): Promise<AiBodyResult> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > AI_REQUEST_MAX_BODY_BYTES) {
    return { ok: false, failure: failure(413, 'Request body is too large.') };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, failure: failure(400, 'Unable to read request body.') };
  }
  if (Buffer.byteLength(raw, 'utf8') > AI_REQUEST_MAX_BODY_BYTES) {
    return { ok: false, failure: failure(413, 'Request body is too large.') };
  }

  try {
    return { ok: true, value: raw.length === 0 ? {} : JSON.parse(raw) };
  } catch {
    return { ok: false, failure: failure(400, 'Request body must be valid JSON.') };
  }
}

export async function preflightAiRequest(params: {
  logTag: string;
  userId: string;
  requestId: string;
  question: string;
  symptoms?: string[];
  changeIntent?: string | null;
}): Promise<AiPreflightResult> {
  if (await isRefusalThrottled(params.logTag, params.userId)) {
    return {
      ok: false,
      failure: failure(
        429,
        'Too many refused Race Engineer requests in a short window. Wait a few minutes before trying again.',
        { 'retry-after': '600' },
      ),
    };
  }

  const promptFingerprint = buildPromptFingerprint({
    question: params.question,
    symptoms: params.symptoms ?? [],
    changeIntent: params.changeIntent ?? null,
    secret: getAiRequestFingerprintSecret(),
  });
  const promptRedactedPreview = buildPromptRedactedPreview(params.question);

  // Atomically reserve a slot BEFORE counting. Every concurrent request will
  // see every other request's pending row, which closes the TOCTOU gap between
  // a bare count and the subsequent insert.
  try {
    await reservePendingSlot({
      logTag: params.logTag,
      userId: params.userId,
      requestId: params.requestId,
      promptFingerprint,
      promptRedactedPreview,
    });
  } catch {
    return {
      ok: false,
      failure: failure(
        503,
        'Rate limit reservation is temporarily unavailable. Please try again shortly.',
        { 'retry-after': '30' },
      ),
    };
  }

  let hourCount: number;
  let minuteCount: number;
  try {
    [hourCount, minuteCount] = await Promise.all([
      countRequestsSince(params.logTag, params.userId, 60 * 60 * 1000),
      countRequestsSince(params.logTag, params.userId, 60 * 1000),
    ]);
  } catch (err) {
    await updateRequestLog({
      logTag: params.logTag,
      requestId: params.requestId,
      status: 'rate_limit_lookup_error',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      failure: failure(
        503,
        'Rate limit check is temporarily unavailable. Please try again shortly.',
        { 'retry-after': '30' },
      ),
    };
  }

  const perHour = getAiRateLimitPerHour();
  const perMinute = getAiRateLimitPerMinute();
  if (hourCount > perHour) {
    await updateRequestLog({ logTag: params.logTag, requestId: params.requestId, status: 'rate_limited_hour' });
    return {
      ok: false,
      failure: failure(429, `Rate limit exceeded: max ${perHour} requests/hour.`, { 'retry-after': '3600' }),
    };
  }
  if (minuteCount > perMinute) {
    await updateRequestLog({ logTag: params.logTag, requestId: params.requestId, status: 'rate_limited_minute' });
    return {
      ok: false,
      failure: failure(429, `Rate limit exceeded: max ${perMinute} requests/minute.`, { 'retry-after': '60' }),
    };
  }

  return { ok: true, promptFingerprint };
}
