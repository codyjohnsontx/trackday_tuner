import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getRealUser } from '@/lib/auth';
import {
  buildPromptFingerprint,
  buildPromptRedactedPreview,
} from '@/lib/ai-observability';
import { assertNotDemoRoute } from '@/lib/demo/mode';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUserProfile } from '@/lib/actions/vehicles';
import { resolveUserAccess } from '@/lib/access';
import {
  getAiRequestFingerprintSecret,
  getAiRateLimitPerHour,
  getAiRateLimitPerMinute,
} from '@/lib/env.server';
import {
  countRequestsSince,
  isRefusalThrottled,
  releaseReservation,
  reservePendingSlot,
  updateRequestLog,
} from '@/lib/rag/ai-request-log';
import { generateTuningAdvice, UpstreamTimeoutError } from '@/lib/rag/advice';
import {
  createRecommendationSnapshot,
  loadRaceEngineerContext,
} from '@/lib/rag/race-engineer-context';
import {
  buildRefusalAdvice,
  classifyRaceEngineerQuestion,
} from '@/lib/rag/domain-guard';
import { evaluateAdvicePolicy } from '@/lib/rag/policy';
import {
  TUNING_ADVICE_LIMITS,
  validateTuningAdviceRequest,
} from '@/lib/rag/validation';
import { fetchPreviousSession } from '@/lib/session-previous';
import { createClient } from '@/lib/supabase/server';
import type { Json, Session, Vehicle } from '@/types';
import type { AdviceDataUsed, AdviceResponse } from '@/lib/rag/schema';

export const runtime = 'nodejs';

const LOG_TAG = 'ai/tuning-advice';

interface ApiErrorBody {
  ok: false;
  error: string;
  request_id: string;
}

const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const HANDLED_AI_REQUEST_STATUSES = [
  'ok',
  'ok_confidence_downgraded',
  'completed_refusal_out_of_domain',
  'completed_refusal_prompt_injection',
  'completed_refusal_refusal_with_changes',
  'completed_refusal_no_recommendation',
  'completed_refusal_invalid_personal_evidence',
  'completed_refusal_unknown_component',
  'completed_refusal_unsupported_direction',
  'completed_refusal_unsafe_magnitude',
  'completed_refusal_ungrounded_recommendation',
  'completed_refusal_high_confidence_without_support',
  'completed_refusal_no_safe_answer',
] as const;

function buildFallbackDataUsed(params: {
  temperatureC?: number;
  session: Session;
  history?: boolean;
  feedback?: boolean;
  lapData?: boolean;
  telemetry?: boolean;
}): AdviceDataUsed {
  return {
    manual: true,
    weather: params.temperatureC != null,
    history: params.history ?? false,
    feedback: params.feedback ?? false,
    lap_data: params.lapData ?? false,
    telemetry: params.telemetry ?? false,
  };
}

function errorResponse(
  status: number,
  error: string,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { ok: false, error, request_id: requestId },
    { status, headers: { 'x-request-id': requestId, ...extraHeaders } },
  );
}

function validRaceEngineerSessionIds(params: {
  session: Session;
  similarSessionIds: string[];
  feedbackSessionIds: Array<string | null | undefined>;
  recommendationSessionIds: Array<string | null | undefined>;
}): string[] {
  return [...new Set([
    params.session.id,
    ...params.similarSessionIds,
    ...params.feedbackSessionIds,
    ...params.recommendationSessionIds,
  ].filter((value): value is string => Boolean(value)))];
}

async function persistRecommendation(params: {
  userId: string;
  requestId: string;
  session: Session;
  advice: AdviceResponse;
  contextSnapshot: Json;
}): Promise<string | null> {
  if (params.advice.refusal || params.advice.recommended_changes.length === 0) {
    return null;
  }

  const primary = params.advice.recommended_changes[0];
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('ai_recommendations')
      .insert({
        user_id: params.userId,
        session_id: params.session.id,
        vehicle_id: params.session.vehicle_id,
        track_id: params.session.track_id,
        request_id: params.requestId,
        summary: params.advice.summary,
        component: primary.component,
        direction: primary.direction,
        magnitude: primary.magnitude,
        predicted_effect: params.advice.prediction.expected_effect,
        status: 'proposed',
        advice: params.advice as unknown as Json,
        context_snapshot: params.contextSnapshot,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[ai/tuning-advice] recommendation insert failed', {
        requestId: params.requestId,
        userId: params.userId,
        error,
      });
      return null;
    }

    return data?.id ?? null;
  } catch (thrown) {
    console.error('[ai/tuning-advice] recommendation insert threw', {
      requestId: params.requestId,
      userId: params.userId,
      thrown,
    });
    return null;
  }
}

async function findRecentDuplicateRequest(params: {
  userId: string;
  sessionId: string;
  requestId: string;
  promptFingerprint: string;
  withinMs: number;
}): Promise<string | null> {
  // Dedupe is a best-effort optimization — fail open on any error so a flaky
  // observability lookup never escalates into a 500 for the user.
  try {
    const admin = createAdminClient();
    const sinceIso = new Date(Date.now() - params.withinMs).toISOString();
    const { data, error } = await admin
      .from('ai_requests')
      .select('request_id')
      .eq('user_id', params.userId)
      .eq('session_id', params.sessionId)
      .eq('prompt_fingerprint', params.promptFingerprint)
      .neq('request_id', params.requestId)
      .in('status', [...HANDLED_AI_REQUEST_STATUSES])
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[ai/tuning-advice] duplicate lookup failed', {
        userId: params.userId,
        sessionId: params.sessionId,
        requestId: params.requestId,
        error,
      });
      return null;
    }

    return data?.[0]?.request_id ?? null;
  } catch (thrown) {
    console.error(
      '[ai/tuning-advice] duplicate lookup threw',
      {
        userId: params.userId,
        sessionId: params.sessionId,
        requestId: params.requestId,
      },
      thrown,
    );
    return null;
  }
}

export async function POST(request: Request) {
  const requestId = randomUUID();

  const demoResponse = await assertNotDemoRoute();
  if (demoResponse) return demoResponse;

  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > TUNING_ADVICE_LIMITS.MAX_BODY_BYTES) {
    return errorResponse(413, 'Request body is too large.', requestId);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return errorResponse(400, 'Unable to read request body.', requestId);
  }
  if (Buffer.byteLength(raw, 'utf8') > TUNING_ADVICE_LIMITS.MAX_BODY_BYTES) {
    return errorResponse(413, 'Request body is too large.', requestId);
  }

  let parsedJson: unknown;
  try {
    parsedJson = raw.length === 0 ? {} : JSON.parse(raw);
  } catch {
    return errorResponse(400, 'Request body must be valid JSON.', requestId);
  }

  const validated = validateTuningAdviceRequest(parsedJson);
  if (!validated.ok) {
    return errorResponse(400, validated.error, requestId);
  }

  const user = await getRealUser();
  if (!user) {
    return errorResponse(401, 'Not authenticated.', requestId);
  }

  const profile = await getUserProfile();
  if (!resolveUserAccess(profile).hasProAccess) {
    return errorResponse(
      402,
      'Race Engineer is a Pro feature. Upgrade to continue.',
      requestId,
    );
  }

  const perHour = getAiRateLimitPerHour();
  const perMinute = getAiRateLimitPerMinute();
  const promptFingerprint = buildPromptFingerprint({
    question: validated.data.question,
    symptoms: validated.data.symptoms,
    changeIntent: validated.data.change_intent,
    secret: getAiRequestFingerprintSecret(),
  });
  const promptRedactedPreview = buildPromptRedactedPreview(validated.data.question);

  if (await isRefusalThrottled(LOG_TAG, user.id)) {
    return errorResponse(
      429,
      'Too many refused Race Engineer requests in a short window. Wait a few minutes before trying again.',
      requestId,
      { 'retry-after': '600' },
    );
  }

  // Atomically reserve a slot BEFORE counting. Every concurrent request will
  // see every other request's pending row, which closes the TOCTOU gap between
  // a bare count and the subsequent insert.
  try {
    await reservePendingSlot({
      logTag: LOG_TAG,
      userId: user.id,
      requestId,
      promptFingerprint,
      promptRedactedPreview,
    });
  } catch {
    return errorResponse(
      503,
      'Rate limit reservation is temporarily unavailable. Please try again shortly.',
      requestId,
      { 'retry-after': '30' },
    );
  }

  let hourCount: number;
  let minuteCount: number;
  try {
    [hourCount, minuteCount] = await Promise.all([
      countRequestsSince(LOG_TAG, user.id, 60 * 60 * 1000),
      countRequestsSince(LOG_TAG, user.id, 60 * 1000),
    ]);
  } catch (err) {
    await updateRequestLog({
      logTag: LOG_TAG,
      requestId,
      status: 'rate_limit_lookup_error',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return errorResponse(
      503,
      'Rate limit check is temporarily unavailable. Please try again shortly.',
      requestId,
      { 'retry-after': '30' },
    );
  }
  if (hourCount > perHour) {
    await updateRequestLog({ logTag: LOG_TAG, requestId, status: 'rate_limited_hour' });
    return errorResponse(
      429,
      `Rate limit exceeded: max ${perHour} requests/hour.`,
      requestId,
      { 'retry-after': '3600' },
    );
  }
  if (minuteCount > perMinute) {
    await updateRequestLog({ logTag: LOG_TAG, requestId, status: 'rate_limited_minute' });
    return errorResponse(
      429,
      `Rate limit exceeded: max ${perMinute} requests/minute.`,
      requestId,
      { 'retry-after': '60' },
    );
  }

  const supabase = await createClient();
  const [sessionResult, vehicleResult] = await Promise.all([
    supabase
      .from('sessions')
      .select('*')
      .eq('id', validated.data.session_id)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('vehicles')
      .select('*')
      .eq('id', validated.data.vehicle_id)
      .eq('user_id', user.id)
      .single(),
  ]);

  const sessionError = sessionResult.error;
  const vehicleError = vehicleResult.error;
  // `.single()` returns a PGRST116 code when zero rows match; those are
  // not-found cases, not transport/DB errors.
  const isNotFound = (err: typeof sessionError) => err?.code === 'PGRST116';
  const hasRealError =
    (sessionError && !isNotFound(sessionError)) ||
    (vehicleError && !isNotFound(vehicleError));

  if (hasRealError) {
    const message =
      sessionError && !isNotFound(sessionError)
        ? sessionError.message
        : vehicleError?.message ?? 'Context lookup failed.';
    await updateRequestLog({
      logTag: LOG_TAG,
      requestId,
      status: 'context_lookup_error',
      errorMessage: message,
    });
    return errorResponse(
      503,
      'Unable to load session context right now. Please try again shortly.',
      requestId,
      { 'retry-after': '30' },
    );
  }

  const session = (sessionResult.data ?? null) as Session | null;
  const vehicle = (vehicleResult.data ?? null) as Vehicle | null;

  if (!session || !vehicle) {
    // A malformed request that references someone else's rows is cheap and
    // should not consume the caller's rate-limit budget; release the slot.
    await releaseReservation(LOG_TAG, requestId);
    return errorResponse(404, 'Session or vehicle not found.', requestId);
  }

  if (session.vehicle_id !== vehicle.id) {
    // A bad cross-reference from the client: free the reservation so it
    // doesn't burn the caller's rate-limit budget, mirroring the 404 path.
    await releaseReservation(LOG_TAG, requestId);
    return errorResponse(
      400,
      'Session does not belong to the provided vehicle.',
      requestId,
    );
  }

  const duplicateRequestId = await findRecentDuplicateRequest({
    userId: user.id,
    sessionId: session.id,
    requestId,
    promptFingerprint,
    withinMs: DEDUPE_WINDOW_MS,
  });

  if (duplicateRequestId) {
    const advice = buildRefusalAdvice({
      reason: 'no_safe_answer',
      message:
        'An identical Race Engineer request was handled recently. Review the previous result or change the question before retrying.',
      dataUsed: buildFallbackDataUsed({
        session,
        temperatureC: validated.data.temperature_c,
      }),
    });

    await updateRequestLog({
      logTag: LOG_TAG,
      requestId,
      sessionId: session.id,
      status: 'duplicate_recent_request',
      refusalReason: 'duplicate_recent_request',
      policyResult: 'force_refusal',
      policyViolations: ['duplicate_recent_request'],
      classifierStage: 'dedupe',
    });

    return NextResponse.json(
      {
        ok: true,
        request_id: requestId,
        recommendation_id: null,
        advice,
        retrieved: [],
      },
      { status: 200, headers: { 'x-request-id': requestId } },
    );
  }

  const previousSession = await fetchPreviousSession(supabase, user.id, session);

  const questionAssessment = classifyRaceEngineerQuestion({
    question: validated.data.question,
    symptoms: validated.data.symptoms,
    changeIntent: validated.data.change_intent,
  });

  if (questionAssessment.decision === 'refuse') {
    const refusalReason = questionAssessment.reason ?? 'out_of_domain';
    const advice = buildRefusalAdvice({
      reason: refusalReason,
      message: questionAssessment.message ?? 'This request is outside trackday setup scope.',
      dataUsed: buildFallbackDataUsed({
        session,
        temperatureC: validated.data.temperature_c,
      }),
    });

    await updateRequestLog({
      logTag: LOG_TAG,
      requestId,
      sessionId: session.id,
      status: `completed_refusal_${refusalReason}`,
      refusalReason,
      policyResult: 'force_refusal',
      policyViolations: [],
      classifierStage: 'preflight',
    });

    return NextResponse.json(
      {
        ok: true,
        request_id: requestId,
        recommendation_id: null,
        advice,
        retrieved: [],
      },
      { status: 200, headers: { 'x-request-id': requestId } },
    );
  }

  try {
    const raceEngineerContext = await loadRaceEngineerContext(supabase, {
      userId: user.id,
      session,
    });

    const result = await generateTuningAdvice({
      session,
      previousSession,
      vehicle,
      question: validated.data.question,
      symptoms: validated.data.symptoms,
      changeIntent: validated.data.change_intent,
      temperatureC: validated.data.temperature_c,
      raceEngineerContext,
    });

    const policyResult = evaluateAdvicePolicy({
      advice: result.advice,
      fallbackDataUsed: {
        ...raceEngineerContext.dataUsed,
        weather:
          validated.data.temperature_c != null || raceEngineerContext.dataUsed.weather,
      },
      validSessionIds: validRaceEngineerSessionIds({
        session,
        similarSessionIds: raceEngineerContext.similarSessions.map((item) => item.session.id),
        feedbackSessionIds: raceEngineerContext.recentFeedback.map((item) => item.session_id),
        recommendationSessionIds: raceEngineerContext.recentRecommendations.flatMap((item) => [
          item.session_id,
          item.outcome_session_id,
        ]),
      }),
    });
    const advice = policyResult.advice;

    const recommendationId = await persistRecommendation({
      userId: user.id,
      requestId,
      session,
      advice,
      contextSnapshot: createRecommendationSnapshot(raceEngineerContext),
    });

    await updateRequestLog({
      logTag: LOG_TAG,
      requestId,
      sessionId: session.id,
      status: advice.refusal
        ? `completed_refusal_${policyResult.violations[0] ?? 'no_safe_answer'}`
        : policyResult.decision === 'downgrade_confidence'
          ? 'ok_confidence_downgraded'
          : 'ok',
      model: result.model,
      promptTokens: result.usage.prompt_tokens,
      completionTokens: result.usage.completion_tokens,
      latencyMs: result.latencyMs,
      refusalReason: advice.refusal ? (policyResult.violations[0] ?? 'no_safe_answer') : null,
      policyResult: policyResult.decision,
      policyViolations: policyResult.violations,
      classifierStage: 'post_policy',
    });

    return NextResponse.json(
      {
        ok: true,
        request_id: requestId,
        recommendation_id: recommendationId,
        advice,
        retrieved: result.retrieved.map(({ chunk, score }) => ({
          source: chunk.source,
          heading: chunk.heading,
          score,
        })),
      },
      { status: 200, headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    const isRetriable = err instanceof UpstreamTimeoutError;
    await updateRequestLog({
      logTag: LOG_TAG,
      requestId,
      sessionId: session.id,
      status: isRetriable ? 'upstream_timeout' : 'error',
      errorMessage: message,
    });
    if (isRetriable) {
      return errorResponse(
        504,
        'The tuning advice service timed out. Please retry.',
        requestId,
        { 'retry-after': '5' },
      );
    }
    return errorResponse(
      500,
      'Unable to generate tuning advice right now. Please try again later.',
      requestId,
    );
  }
}
