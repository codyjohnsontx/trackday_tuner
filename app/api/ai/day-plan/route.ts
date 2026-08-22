import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getRealUser } from '@/lib/auth';
import {
  buildPromptFingerprint,
  buildPromptRedactedPreview,
} from '@/lib/ai-observability';
import { getUserProfile } from '@/lib/actions/vehicles';
import { resolveUserAccess } from '@/lib/access';
import { assertNotDemoRoute } from '@/lib/demo/mode';
import {
  getAiRequestFingerprintSecret,
  getAiRateLimitPerHour,
  getAiRateLimitPerMinute,
} from '@/lib/env.server';
import { createClient } from '@/lib/supabase/server';
import { generateDayPlan, UpstreamTimeoutError } from '@/lib/rag/advice';
import {
  countRequestsSince,
  isRefusalThrottled,
  releaseReservation,
  reservePendingSlot,
  updateRequestLog,
} from '@/lib/rag/ai-request-log';
import {
  buildRefusalAdvice,
  classifyDayPlanRequest,
} from '@/lib/rag/domain-guard';
import { evaluateAdvicePolicy } from '@/lib/rag/policy';
import { AI_REQUEST_MAX_BODY_BYTES, isUuid } from '@/lib/rag/validation';
import {
  buildDayTrend,
  hasManualSessionData,
  selectSimilarSessions,
  type RaceEngineerContext,
} from '@/lib/rag/race-engineer-context';
import type { AdviceDataUsed } from '@/lib/rag/schema';
import type {
  CreateSessionEnvironmentInput,
  RaceEngineerMemory,
  Session,
  SessionEnvironment,
  SessionFeedback,
  Vehicle,
} from '@/types';

export const runtime = 'nodejs';

const LOG_TAG = 'ai/day-plan';

interface DayPlanRequest {
  vehicle_id: string;
  target_date?: string;
  time_zone?: string;
  track_name?: string;
  ambient_temperature_c?: number;
  track_temperature_c?: number;
  humidity_percent?: number;
  weather_condition?: string;
  surface_condition?: string;
}

type ValidationResult =
  | { ok: true; data: DayPlanRequest }
  | { ok: false; error: string };

type NumberValidationResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

function errorResponse(
  status: number,
  error: string,
  requestId: string,
  extraHeaders: Record<string, string> = {},
) {
  return NextResponse.json(
    { ok: false, error, request_id: requestId },
    { status, headers: { 'x-request-id': requestId, ...extraHeaders } },
  );
}

function validateNumber(
  record: Record<string, unknown>,
  key: keyof DayPlanRequest,
  min: number,
  max: number,
): NumberValidationResult | undefined {
  const value = record[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `${key} must be a number.` };
  }
  if (value < min || value > max) {
    return { ok: false, error: `${key} must be between ${min} and ${max}.` };
  }
  return { ok: true, value };
}

function validateDayPlanRequest(input: unknown): ValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set([
    'vehicle_id',
    'target_date',
    'time_zone',
    'track_name',
    'ambient_temperature_c',
    'track_temperature_c',
    'humidity_percent',
    'weather_condition',
    'surface_condition',
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return { ok: false, error: `Unknown field: ${key}.` };
  }

  if (!isUuid(record.vehicle_id)) {
    return { ok: false, error: 'vehicle_id must be a UUID.' };
  }

  const targetDate = typeof record.target_date === 'string' && record.target_date.trim()
    ? record.target_date.trim()
    : undefined;
  if (targetDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate);
    if (!match) {
      return { ok: false, error: 'target_date must be YYYY-MM-DD.' };
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsedDate = new Date(year, month - 1, day);
    if (
      parsedDate.getFullYear() !== year ||
      parsedDate.getMonth() !== month - 1 ||
      parsedDate.getDate() !== day
    ) {
      return { ok: false, error: 'target_date must be YYYY-MM-DD.' };
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(record, 'time_zone') &&
    record.time_zone !== undefined &&
    record.time_zone !== null &&
    typeof record.time_zone !== 'string'
  ) {
    return { ok: false, error: 'time_zone must be a string.' };
  }
  const timeZone = typeof record.time_zone === 'string' && record.time_zone.trim()
    ? record.time_zone.trim()
    : undefined;
  if (timeZone && timeZone.length > 100) {
    return { ok: false, error: 'time_zone must be at most 100 characters.' };
  }

  if (
    Object.prototype.hasOwnProperty.call(record, 'track_name') &&
    record.track_name !== undefined &&
    record.track_name !== null &&
    typeof record.track_name !== 'string'
  ) {
    return { ok: false, error: 'track_name must be a string.' };
  }
  const trackName = typeof record.track_name === 'string' ? record.track_name.trim() : undefined;
  if (trackName && trackName.length > 120) {
    return { ok: false, error: 'track_name must be at most 120 characters.' };
  }

  const ambient = validateNumber(record, 'ambient_temperature_c', -40, 70);
  if (ambient && !ambient.ok) return ambient;
  const track = validateNumber(record, 'track_temperature_c', -40, 95);
  if (track && !track.ok) return track;
  const humidity = validateNumber(record, 'humidity_percent', 0, 100);
  if (humidity && !humidity.ok) return humidity;

  if (
    Object.prototype.hasOwnProperty.call(record, 'weather_condition') &&
    record.weather_condition !== undefined &&
    record.weather_condition !== null &&
    typeof record.weather_condition !== 'string'
  ) {
    return { ok: false, error: 'weather_condition must be a string.' };
  }
  const weather = typeof record.weather_condition === 'string'
    ? record.weather_condition.trim()
    : undefined;
  if (weather && weather.length > 64) {
    return { ok: false, error: 'weather_condition must be at most 64 characters.' };
  }

  if (
    Object.prototype.hasOwnProperty.call(record, 'surface_condition') &&
    record.surface_condition !== undefined &&
    record.surface_condition !== null &&
    typeof record.surface_condition !== 'string'
  ) {
    return { ok: false, error: 'surface_condition must be a string.' };
  }
  const surface = typeof record.surface_condition === 'string'
    ? record.surface_condition.trim()
    : undefined;
  if (surface && surface.length > 80) {
    return { ok: false, error: 'surface_condition must be at most 80 characters.' };
  }

  return {
    ok: true,
    data: {
      vehicle_id: record.vehicle_id,
      target_date: targetDate,
      time_zone: timeZone,
      track_name: trackName || undefined,
      ambient_temperature_c: ambient?.value,
      track_temperature_c: track?.value,
      humidity_percent: humidity?.value,
      weather_condition: weather || undefined,
      surface_condition: surface || undefined,
    },
  };
}

function todayIso(timeZone?: string): string {
  const now = new Date();
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(now);
      const year = parts.find((part) => part.type === 'year')?.value;
      const month = parts.find((part) => part.type === 'month')?.value;
      const day = parts.find((part) => part.type === 'day')?.value;
      if (year && month && day) {
        return `${year}-${month}-${day}`;
      }
    } catch {
      // Fall through to the server-local date if the provided time zone is invalid.
    }
  }

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildContext(params: {
  userId: string;
  targetDate: string;
  trackName?: string;
  recentSessions: Session[];
  recentEnvironments: SessionEnvironment[];
  environment: CreateSessionEnvironmentInput | null;
  memory: RaceEngineerMemory | null;
  feedback: SessionFeedback[];
}): RaceEngineerContext {
  const planningSessionId = params.recentSessions[0]
    ? `planned-${params.targetDate}-${params.recentSessions[0].id}`
    : `planned-${params.targetDate}`;
  const currentEnvironment = params.environment
    ? ({
        id: `planned-env-${planningSessionId}`,
        user_id: params.userId,
        session_id: planningSessionId,
        ambient_temperature_c: params.environment.ambient_temperature_c ?? null,
        track_temperature_c: params.environment.track_temperature_c ?? null,
        humidity_percent: params.environment.humidity_percent ?? null,
        weather_condition: params.environment.weather_condition ?? null,
        surface_condition: params.environment.surface_condition ?? null,
        source: params.environment.source ?? 'manual',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } satisfies SessionEnvironment)
    : null;

  if (params.recentSessions.length === 0) {
    return {
      similarSessions: [],
      sessionEnvironment: currentEnvironment,
      recentFeedback: params.feedback,
      recentRecommendations: [],
      memory: params.memory,
      telemetrySummary: null,
      dayTrend: params.environment
        ? 'A planned environment is available, but there is no prior session history for this vehicle yet.'
        : 'No planned environment or prior session history is available yet.',
      dataUsed: {
        manual: false,
        weather: Boolean(params.environment),
        history: false,
        feedback: params.feedback.length > 0,
        lap_data: false,
        telemetry: false,
      },
    };
  }

  const baseline = params.recentSessions[0];
  const normalizedTrackName = params.trackName?.trim();
  const matchesBaselineTrack =
    normalizedTrackName &&
    baseline.track_name &&
    normalizedTrackName.toLowerCase() === baseline.track_name.trim().toLowerCase();
  const planningSession: Session = {
    ...baseline,
    id: planningSessionId,
    date: params.targetDate,
    start_time: null,
    track_name: normalizedTrackName || baseline.track_name,
    track_id: matchesBaselineTrack ? baseline.track_id : null,
  };

  const environments = currentEnvironment
    ? [currentEnvironment, ...params.recentEnvironments]
    : params.recentEnvironments;
  const similarSessions = selectSimilarSessions({
    current: planningSession,
    candidates: params.recentSessions,
    environments,
    limit: 6,
  });

  return {
    similarSessions,
    sessionEnvironment: currentEnvironment,
    recentFeedback: params.feedback,
    recentRecommendations: [],
    memory: params.memory,
    telemetrySummary: null,
    dayTrend: buildDayTrend(planningSession, currentEnvironment, similarSessions),
    dataUsed: {
      manual: hasManualSessionData(planningSession),
      weather: Boolean(currentEnvironment),
      history: similarSessions.length > 0,
      feedback: params.feedback.length > 0,
      lap_data: false,
      telemetry: false,
    },
  };
}

async function findTargetTrackId(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  trackName?: string;
}): Promise<string | null> {
  const trackName = params.trackName?.trim();
  if (!trackName) return null;

  const { data, error } = await params.supabase
    .from('tracks')
    .select('id')
    .eq('name', trackName)
    .or(`is_seeded.eq.true,created_by.eq.${params.userId}`)
    .limit(1);

  if (error) {
    console.error('[ai/day-plan] track lookup failed', {
      userId: params.userId,
      trackName,
      error: error.message,
    });
    return null;
  }

  return data?.[0]?.id ?? null;
}

async function loadPreferredMemory(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  vehicleId: string;
  trackId: string | null;
}): Promise<RaceEngineerMemory | null> {
  if (params.trackId) {
    const { data, error } = await params.supabase
      .from('race_engineer_memory')
      .select('*')
      .eq('user_id', params.userId)
      .eq('vehicle_id', params.vehicleId)
      .eq('track_id', params.trackId)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[ai/day-plan] exact-track memory query failed', {
        userId: params.userId,
        vehicleId: params.vehicleId,
        trackId: params.trackId,
        error: error.message,
      });
    } else if (data?.[0]) {
      return data[0] as RaceEngineerMemory;
    }
  }

  const { data, error } = await params.supabase
    .from('race_engineer_memory')
    .select('*')
    .eq('user_id', params.userId)
    .eq('vehicle_id', params.vehicleId)
    .is('track_id', null)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[ai/day-plan] fallback memory query failed', {
      userId: params.userId,
      vehicleId: params.vehicleId,
      error: error.message,
    });
    return null;
  }

  return (data?.[0] ?? null) as RaceEngineerMemory | null;
}

/**
 * What the model was actually given, for a request that never got as far as
 * generating anything. A day plan reports no manual session data because there
 * is no logged session behind it - only the conditions the rider typed in.
 */
function refusalDataUsed(hasEnvironment: boolean): AdviceDataUsed {
  return {
    manual: false,
    weather: hasEnvironment,
    history: false,
    feedback: false,
    lap_data: false,
    telemetry: false,
  };
}

export async function POST(request: Request) {
  const requestId = randomUUID();

  const demoResponse = await assertNotDemoRoute();
  if (demoResponse) return demoResponse;

  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > AI_REQUEST_MAX_BODY_BYTES) {
    return errorResponse(413, 'Request body is too large.', requestId);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return errorResponse(400, 'Unable to read request body.', requestId);
  }
  if (Buffer.byteLength(raw, 'utf8') > AI_REQUEST_MAX_BODY_BYTES) {
    return errorResponse(413, 'Request body is too large.', requestId);
  }

  let parsedJson: unknown;
  try {
    parsedJson = raw.length === 0 ? {} : JSON.parse(raw);
  } catch {
    return errorResponse(400, 'Request body must be valid JSON.', requestId);
  }

  const user = await getRealUser();
  if (!user) {
    return errorResponse(401, 'Not authenticated.', requestId);
  }

  const profile = await getUserProfile();
  if (!resolveUserAccess(profile).hasProAccess) {
    return errorResponse(402, 'Race Engineer is a Pro feature. Upgrade to continue.', requestId);
  }

  const validated = validateDayPlanRequest(parsedJson);
  if (!validated.ok) {
    return errorResponse(400, validated.error, requestId);
  }

  const computedTargetDate = validated.data.target_date ?? todayIso(validated.data.time_zone);
  const environment: CreateSessionEnvironmentInput = {
    ambient_temperature_c: validated.data.ambient_temperature_c ?? null,
    track_temperature_c: validated.data.track_temperature_c ?? null,
    humidity_percent: validated.data.humidity_percent ?? null,
    weather_condition: validated.data.weather_condition ?? null,
    surface_condition: validated.data.surface_condition ?? null,
    source: 'manual',
  };
  // hasEnvironment intentionally ignores the default source value 'manual' so the
  // environment object only counts as present when it contains meaningful runtime input.
  const hasEnvironment = Object.values(environment).some((value) => {
    if (typeof value === 'number') return Number.isFinite(value);
    return typeof value === 'string' && value.trim() !== '' && value !== 'manual';
  });

  if (await isRefusalThrottled(LOG_TAG, user.id)) {
    return errorResponse(
      429,
      'Too many refused Race Engineer requests in a short window. Wait a few minutes before trying again.',
      requestId,
      { 'retry-after': '600' },
    );
  }

  // The day plan carries no free-text question, so the audited prompt subject is
  // the request itself: the day being planned plus whatever the rider typed
  // about the track and conditions. That is also the only rider-authored text
  // that reaches the model.
  const riderText = [
    validated.data.track_name ?? '',
    validated.data.weather_condition ?? '',
    validated.data.surface_condition ?? '',
  ]
    .filter((part) => part.trim().length > 0)
    .join(' | ');
  const promptSubject = [`day-plan ${computedTargetDate}`, riderText]
    .filter((part) => part.trim().length > 0)
    .join(' | ');
  const promptFingerprint = buildPromptFingerprint({
    question: promptSubject,
    symptoms: [],
    changeIntent: null,
    secret: getAiRequestFingerprintSecret(),
  });
  const promptRedactedPreview = buildPromptRedactedPreview(promptSubject);

  // Reserve the slot BEFORE counting so concurrent requests see each other's
  // pending rows, the same TOCTOU close the tuning-advice route makes. The row
  // is also what every later status update writes to.
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

  const perHour = getAiRateLimitPerHour();
  const perMinute = getAiRateLimitPerMinute();
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
  const { data: vehicleRow, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', validated.data.vehicle_id)
    .eq('user_id', user.id)
    .single();

  if (vehicleError || !vehicleRow) {
    // A request naming someone else's vehicle is cheap and should not consume
    // the caller's rate-limit budget; release the slot, as tuning-advice does.
    await releaseReservation(LOG_TAG, requestId);
    return errorResponse(404, 'Vehicle not found.', requestId);
  }

  const assessment = classifyDayPlanRequest({
    trackName: validated.data.track_name,
    weatherCondition: validated.data.weather_condition,
    surfaceCondition: validated.data.surface_condition,
  });

  if (assessment.decision === 'refuse') {
    const refusalReason = assessment.reason ?? 'out_of_domain';
    const advice = buildRefusalAdvice({
      reason: refusalReason,
      message: assessment.message ?? 'This request is outside trackday setup scope.',
      dataUsed: refusalDataUsed(hasEnvironment),
    });

    await updateRequestLog({
      logTag: LOG_TAG,
      requestId,
      status: `completed_refusal_${refusalReason}`,
      refusalReason,
      policyResult: 'force_refusal',
      policyViolations: [],
      classifierStage: 'preflight',
    });

    return NextResponse.json(
      { ok: true, request_id: requestId, advice, retrieved: [] },
      { status: 200, headers: { 'x-request-id': requestId } },
    );
  }

  const vehicle = vehicleRow as Vehicle;
  const [sessionsResult, feedbackResult, targetTrackId] = await Promise.all([
    supabase
      .from('sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('vehicle_id', vehicle.id)
      .order('date', { ascending: false })
      .order('start_time', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('session_feedback')
      .select('*')
      .eq('user_id', user.id)
      .eq('vehicle_id', vehicle.id)
      .order('created_at', { ascending: false })
      .limit(5),
    findTargetTrackId({
      supabase,
      userId: user.id,
      trackName: validated.data.track_name,
    }),
  ]);

  if (sessionsResult.error) {
    console.error('[ai/day-plan] sessions query failed', {
      userId: user.id,
      vehicleId: vehicle.id,
      error: sessionsResult.error.message,
    });
  }
  if (feedbackResult.error) {
    console.error('[ai/day-plan] feedback query failed', {
      userId: user.id,
      vehicleId: vehicle.id,
      error: feedbackResult.error.message,
    });
  }

  const recentSessions = (sessionsResult.data ?? []) as Session[];
  const recentSessionIds = recentSessions.map((session) => session.id);
  const [environmentsResult, memory] = await Promise.all([
    recentSessionIds.length > 0
      ? supabase
          .from('session_environment')
          .select('*')
          .eq('user_id', user.id)
          .in('session_id', recentSessionIds)
      : Promise.resolve({ data: [], error: null }),
    loadPreferredMemory({
      supabase,
      userId: user.id,
      vehicleId: vehicle.id,
      trackId: targetTrackId,
    }),
  ]);
  if (environmentsResult.error) {
    console.error('[ai/day-plan] environments query failed', {
      userId: user.id,
      vehicleId: vehicle.id,
      error: environmentsResult.error.message,
    });
  }
  if (sessionsResult.error || feedbackResult.error || environmentsResult.error) {
    await updateRequestLog({
      logTag: LOG_TAG,
      requestId,
      status: 'context_lookup_error',
      errorMessage:
        sessionsResult.error?.message ??
        feedbackResult.error?.message ??
        environmentsResult.error?.message ??
        'Planning history lookup failed.',
    });
    return errorResponse(500, 'Unable to load planning history right now.', requestId);
  }
  const recentEnvironments = (environmentsResult.data ?? []) as SessionEnvironment[];
  const feedback = (feedbackResult.data ?? []) as SessionFeedback[];

  try {
    const raceEngineerContext = buildContext({
      userId: user.id,
      targetDate: computedTargetDate,
      trackName: validated.data.track_name,
      recentSessions,
      recentEnvironments,
      environment: hasEnvironment ? environment : null,
      memory,
      feedback,
    });

    const result = await generateDayPlan({
      vehicle,
      targetDate: computedTargetDate,
      trackName: validated.data.track_name,
      environment: hasEnvironment ? environment : null,
      recentSessions,
      raceEngineerContext,
    });

    // Only real, persisted sessions ground personal evidence. The planning
    // session buildContext synthesises is not one of them, so its id is
    // deliberately absent here: a plan citing it would be citing itself.
    const policyResult = evaluateAdvicePolicy({
      advice: result.advice,
      fallbackDataUsed: raceEngineerContext.dataUsed,
      validSessionIds: [
        ...recentSessionIds,
        ...feedback.map((entry) => entry.session_id),
      ].filter((value): value is string => Boolean(value)),
      // A morning plan whose right answer is "run your baseline and check hot
      // pressures" recommends no change, and the day-plan prompt says so
      // explicitly. Every other policy check still applies.
      allowEmptyRecommendations: true,
    });
    const advice = policyResult.advice;

    await updateRequestLog({
      logTag: LOG_TAG,
      requestId,
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
      status: isRetriable ? 'upstream_timeout' : 'error',
      errorMessage: message,
    });
    if (isRetriable) {
      return errorResponse(
        504,
        'The day-plan service timed out. Please retry.',
        requestId,
        { 'retry-after': '5' },
      );
    }
    console.error('[ai/day-plan]', err);
    return errorResponse(500, 'Unable to generate a day plan right now.', requestId);
  }
}
