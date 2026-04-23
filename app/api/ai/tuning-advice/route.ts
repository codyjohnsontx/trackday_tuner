import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getAuthenticatedUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUserProfile } from '@/lib/actions/vehicles';
import {
  getAiRateLimitPerHour,
  getAiRateLimitPerMinute,
} from '@/lib/env.server';
import { generateTuningAdvice, UpstreamTimeoutError } from '@/lib/rag/advice';
import {
  createRecommendationSnapshot,
  loadRaceEngineerContext,
} from '@/lib/rag/race-engineer-context';
import {
  TUNING_ADVICE_LIMITS,
  validateTuningAdviceRequest,
} from '@/lib/rag/validation';
import { createClient } from '@/lib/supabase/server';
import type { Json, Session, Vehicle } from '@/types';
import type { AdviceResponse } from '@/lib/rag/schema';

export const runtime = 'nodejs';

interface ApiErrorBody {
  ok: false;
  error: string;
  request_id: string;
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

class RateLimitLookupError extends Error {
  constructor(cause: unknown) {
    super('Rate limit lookup failed.');
    this.name = 'RateLimitLookupError';
    this.cause = cause;
  }
}

class ReservationError extends Error {
  constructor(cause: unknown) {
    super('Rate limit reservation failed.');
    this.name = 'ReservationError';
    this.cause = cause;
  }
}

async function reservePendingSlot(params: {
  userId: string;
  requestId: string;
}): Promise<void> {
  const admin = createAdminClient();
  // session_id starts null: the caller has not yet confirmed the referenced
  // session exists, and ai_requests.session_id has a FK to sessions(id) that
  // would otherwise reject a bogus reference with 503 instead of 404. The
  // real session_id is stamped on after the context lookup succeeds.
  const { error } = await admin.from('ai_requests').insert({
    user_id: params.userId,
    session_id: null,
    request_id: params.requestId,
    status: 'pending',
  });
  if (error) {
    console.error('[ai/tuning-advice] reservation insert failed', error);
    throw new ReservationError(error);
  }
}

interface UpdateRequestLogParams {
  requestId: string;
  status: string;
  sessionId?: string | null;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs?: number | null;
  errorMessage?: string | null;
}

async function updateRequestLog(params: UpdateRequestLogParams): Promise<void> {
  const patch: Record<string, unknown> = {
    status: params.status,
    model: params.model ?? null,
    prompt_tokens: params.promptTokens ?? null,
    completion_tokens: params.completionTokens ?? null,
    latency_ms: params.latencyMs ?? null,
    error_message: params.errorMessage ?? null,
  };
  if (params.sessionId !== undefined) {
    patch.session_id = params.sessionId;
  }
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from('ai_requests')
      .update(patch)
      .eq('request_id', params.requestId);
    if (error) {
      console.error(
        '[ai/tuning-advice] updateRequestLog failed',
        { requestId: params.requestId, status: params.status },
        error,
      );
    }
  } catch (thrown) {
    // Guard against transport-layer exceptions (e.g., fetch timeouts) so
    // logging never shadows the user-facing response.
    console.error('[ai/tuning-advice] updateRequestLog threw', thrown);
  }
}

async function releaseReservation(requestId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from('ai_requests')
      .delete()
      .eq('request_id', requestId);
    if (error) {
      console.error('[ai/tuning-advice] releaseReservation failed', { requestId }, error);
    }
  } catch (thrown) {
    // Best effort: the row will age out of the rate-limit window even if
    // this fails, but we still want to observe the failure.
    console.error('[ai/tuning-advice] releaseReservation threw', thrown);
  }
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
    console.error('[ai/tuning-advice] recommendation insert failed', error);
    return null;
  }

  return data?.id ?? null;
}

async function countRequestsSince(
  userId: string,
  sinceMs: number,
): Promise<number> {
  const admin = createAdminClient();
  const sinceIso = new Date(Date.now() - sinceMs).toISOString();
  const { count, error } = await admin
    .from('ai_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', sinceIso);
  if (error) {
    console.error('[ai/tuning-advice] rate limit count failed', error);
    throw new RateLimitLookupError(error);
  }
  return count ?? 0;
}

export async function POST(request: Request) {
  const requestId = randomUUID();

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

  const user = await getAuthenticatedUser();
  if (!user) {
    return errorResponse(401, 'Not authenticated.', requestId);
  }

  const profile = await getUserProfile();
  if ((profile?.tier ?? 'free') !== 'pro') {
    return errorResponse(
      402,
      'Race Engineer is a Pro feature. Upgrade to continue.',
      requestId,
    );
  }

  const perHour = getAiRateLimitPerHour();
  const perMinute = getAiRateLimitPerMinute();

  // Atomically reserve a slot BEFORE counting. Every concurrent request will
  // see every other request's pending row, which closes the TOCTOU gap between
  // a bare count and the subsequent insert.
  try {
    await reservePendingSlot({ userId: user.id, requestId });
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
      countRequestsSince(user.id, 60 * 60 * 1000),
      countRequestsSince(user.id, 60 * 1000),
    ]);
  } catch (err) {
    await updateRequestLog({
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
    await updateRequestLog({ requestId, status: 'rate_limited_hour' });
    return errorResponse(
      429,
      `Rate limit exceeded: max ${perHour} requests/hour.`,
      requestId,
      { 'retry-after': '3600' },
    );
  }
  if (minuteCount > perMinute) {
    await updateRequestLog({ requestId, status: 'rate_limited_minute' });
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
    await releaseReservation(requestId);
    return errorResponse(404, 'Session or vehicle not found.', requestId);
  }

  if (session.vehicle_id !== vehicle.id) {
    // A bad cross-reference from the client: free the reservation so it
    // doesn't burn the caller's rate-limit budget, mirroring the 404 path.
    await releaseReservation(requestId);
    return errorResponse(
      400,
      'Session does not belong to the provided vehicle.',
      requestId,
    );
  }

  const { data: previousRows } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .eq('vehicle_id', vehicle.id)
    .neq('id', session.id)
    .or(
      `date.lt.${session.date},and(date.eq.${session.date},start_time.lt.${
        session.start_time ?? '23:59:59'
      })`,
    )
    .order('date', { ascending: false })
    .order('start_time', { ascending: false, nullsFirst: false })
    .limit(1);

  const previousSession = (previousRows?.[0] ?? null) as Session | null;

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

    const recommendationId = await persistRecommendation({
      userId: user.id,
      requestId,
      session,
      advice: result.advice,
      contextSnapshot: createRecommendationSnapshot(raceEngineerContext),
    });

    await updateRequestLog({
      requestId,
      sessionId: session.id,
      status: result.advice.refusal ? 'refused' : 'ok',
      model: result.model,
      promptTokens: result.usage.prompt_tokens,
      completionTokens: result.usage.completion_tokens,
      latencyMs: result.latencyMs,
    });

    return NextResponse.json(
      {
        ok: true,
        request_id: requestId,
        recommendation_id: recommendationId,
        advice: result.advice,
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
