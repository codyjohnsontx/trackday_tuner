import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getAuthenticatedUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUserProfile } from '@/lib/actions/vehicles';
import {
  getAiRateLimitPerHour,
  getAiRateLimitPerMinute,
} from '@/lib/env.server';
import { generateTuningAdvice } from '@/lib/rag/advice';
import {
  TUNING_ADVICE_LIMITS,
  validateTuningAdviceRequest,
} from '@/lib/rag/validation';
import { createClient } from '@/lib/supabase/server';
import type { Session, Vehicle } from '@/types';

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

async function logRequest(params: {
  userId: string;
  sessionId: string | null;
  requestId: string;
  status: string;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs?: number | null;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('ai_requests').insert({
      user_id: params.userId,
      session_id: params.sessionId,
      request_id: params.requestId,
      status: params.status,
      model: params.model ?? null,
      prompt_tokens: params.promptTokens ?? null,
      completion_tokens: params.completionTokens ?? null,
      latency_ms: params.latencyMs ?? null,
      error_message: params.errorMessage ?? null,
    });
  } catch {
    // Swallow logging errors so they never shadow the user-facing response.
  }
}

class RateLimitLookupError extends Error {
  constructor(cause: unknown) {
    super('Rate limit lookup failed.');
    this.name = 'RateLimitLookupError';
    this.cause = cause;
  }
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
  let hourCount: number;
  let minuteCount: number;
  try {
    [hourCount, minuteCount] = await Promise.all([
      countRequestsSince(user.id, 60 * 60 * 1000),
      countRequestsSince(user.id, 60 * 1000),
    ]);
  } catch (err) {
    await logRequest({
      userId: user.id,
      sessionId: validated.data.session_id,
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
  if (hourCount >= perHour) {
    await logRequest({
      userId: user.id,
      sessionId: validated.data.session_id,
      requestId,
      status: 'rate_limited_hour',
    });
    return errorResponse(
      429,
      `Rate limit exceeded: max ${perHour} requests/hour.`,
      requestId,
      { 'retry-after': '3600' },
    );
  }
  if (minuteCount >= perMinute) {
    await logRequest({
      userId: user.id,
      sessionId: validated.data.session_id,
      requestId,
      status: 'rate_limited_minute',
    });
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

  const session = (sessionResult.data ?? null) as Session | null;
  const vehicle = (vehicleResult.data ?? null) as Vehicle | null;

  if (!session || !vehicle) {
    await logRequest({
      userId: user.id,
      sessionId: validated.data.session_id,
      requestId,
      status: 'context_not_found',
    });
    return errorResponse(404, 'Session or vehicle not found.', requestId);
  }

  if (session.vehicle_id !== vehicle.id) {
    await logRequest({
      userId: user.id,
      sessionId: validated.data.session_id,
      requestId,
      status: 'mismatched_ids',
    });
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
    const result = await generateTuningAdvice({
      session,
      previousSession,
      vehicle,
      question: validated.data.question,
      symptoms: validated.data.symptoms,
      changeIntent: validated.data.change_intent,
      temperatureC: validated.data.temperature_c,
    });

    await logRequest({
      userId: user.id,
      sessionId: session.id,
      requestId,
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
    await logRequest({
      userId: user.id,
      sessionId: session.id,
      requestId,
      status: 'error',
      errorMessage: message,
    });
    return errorResponse(
      500,
      'Unable to generate tuning advice right now. Please try again later.',
      requestId,
    );
  }
}
