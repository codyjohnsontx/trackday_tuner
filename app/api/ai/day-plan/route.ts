import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getAuthenticatedUser } from '@/lib/auth';
import { getUserProfile } from '@/lib/actions/vehicles';
import { createClient } from '@/lib/supabase/server';
import { generateDayPlan, UpstreamTimeoutError } from '@/lib/rag/advice';
import type { RaceEngineerContext } from '@/lib/rag/race-engineer-context';
import type {
  CreateSessionEnvironmentInput,
  RaceEngineerMemory,
  Session,
  SessionFeedback,
  Vehicle,
} from '@/types';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface DayPlanRequest {
  vehicle_id: string;
  target_date?: string;
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

function errorResponse(status: number, error: string, requestId: string) {
  return NextResponse.json(
    { ok: false, error, request_id: requestId },
    { status, headers: { 'x-request-id': requestId } },
  );
}

function validateNumber(
  record: Record<string, unknown>,
  key: keyof DayPlanRequest,
  min: number,
  max: number,
): number | undefined | ValidationResult {
  const value = record[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `${key} must be a number.` };
  }
  if (value < min || value > max) {
    return { ok: false, error: `${key} must be between ${min} and ${max}.` };
  }
  return value;
}

function validateDayPlanRequest(input: unknown): ValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set([
    'vehicle_id',
    'target_date',
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

  if (typeof record.vehicle_id !== 'string' || !UUID_PATTERN.test(record.vehicle_id)) {
    return { ok: false, error: 'vehicle_id must be a UUID.' };
  }

  const targetDate = typeof record.target_date === 'string' && record.target_date.trim()
    ? record.target_date.trim()
    : undefined;
  if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return { ok: false, error: 'target_date must be YYYY-MM-DD.' };
  }

  const trackName = typeof record.track_name === 'string' ? record.track_name.trim() : undefined;
  if (trackName && trackName.length > 120) {
    return { ok: false, error: 'track_name must be at most 120 characters.' };
  }

  const ambient = validateNumber(record, 'ambient_temperature_c', -40, 70);
  if (typeof ambient === 'object') return ambient;
  const track = validateNumber(record, 'track_temperature_c', -40, 95);
  if (typeof track === 'object') return track;
  const humidity = validateNumber(record, 'humidity_percent', 0, 100);
  if (typeof humidity === 'object') return humidity;

  const weather = typeof record.weather_condition === 'string'
    ? record.weather_condition.trim()
    : undefined;
  if (weather && weather.length > 64) {
    return { ok: false, error: 'weather_condition must be at most 64 characters.' };
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
      track_name: trackName || undefined,
      ambient_temperature_c: ambient,
      track_temperature_c: track,
      humidity_percent: humidity,
      weather_condition: weather || undefined,
      surface_condition: surface || undefined,
    },
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildContext(params: {
  recentSessions: Session[];
  memory: RaceEngineerMemory | null;
  feedback: SessionFeedback[];
  hasEnvironment: boolean;
}): RaceEngineerContext {
  return {
    similarSessions: params.recentSessions.slice(0, 6).map((session, idx) => ({
      session,
      score: Math.max(1, 6 - idx),
      reasons: ['recent vehicle history'],
      environment: null,
    })),
    sessionEnvironment: null,
    recentFeedback: params.feedback,
    recentRecommendations: [],
    memory: params.memory,
    telemetrySummary: null,
    dayTrend: params.hasEnvironment
      ? 'Use the planned environment as a prediction input and verify hot pressures after the first full session.'
      : 'No planned environment was provided; start from recent baseline and verify hot pressures early.',
    dataUsed: {
      manual: true,
      weather: params.hasEnvironment,
      history: params.recentSessions.length > 0,
      feedback: params.feedback.length > 0,
      telemetry: false,
    },
  };
}

export async function POST(request: Request) {
  const requestId = randomUUID();

  let parsedJson: unknown;
  try {
    parsedJson = await request.json();
  } catch {
    return errorResponse(400, 'Request body must be valid JSON.', requestId);
  }

  const validated = validateDayPlanRequest(parsedJson);
  if (!validated.ok) {
    return errorResponse(400, validated.error, requestId);
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return errorResponse(401, 'Not authenticated.', requestId);
  }

  const profile = await getUserProfile();
  if ((profile?.tier ?? 'free') !== 'pro') {
    return errorResponse(402, 'Race Engineer is a Pro feature. Upgrade to continue.', requestId);
  }

  const supabase = await createClient();
  const { data: vehicleRow, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', validated.data.vehicle_id)
    .eq('user_id', user.id)
    .single();

  if (vehicleError || !vehicleRow) {
    return errorResponse(404, 'Vehicle not found.', requestId);
  }

  const vehicle = vehicleRow as Vehicle;
  const [sessionsResult, memoryResult, feedbackResult] = await Promise.all([
    supabase
      .from('sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('vehicle_id', vehicle.id)
      .order('date', { ascending: false })
      .order('start_time', { ascending: false, nullsFirst: false })
      .limit(10),
    supabase
      .from('race_engineer_memory')
      .select('*')
      .eq('user_id', user.id)
      .eq('vehicle_id', vehicle.id)
      .order('updated_at', { ascending: false })
      .limit(1),
    supabase
      .from('session_feedback')
      .select('*')
      .eq('user_id', user.id)
      .eq('vehicle_id', vehicle.id)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  if (sessionsResult.error) {
    console.error('[ai/day-plan] sessions query failed', {
      userId: user.id,
      vehicleId: vehicle.id,
      error: sessionsResult.error.message,
    });
  }
  if (memoryResult.error) {
    console.error('[ai/day-plan] memory query failed', {
      userId: user.id,
      vehicleId: vehicle.id,
      error: memoryResult.error.message,
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
  const memory = ((memoryResult.data ?? [])[0] ?? null) as RaceEngineerMemory | null;
  const feedback = (feedbackResult.data ?? []) as SessionFeedback[];
  const environment: CreateSessionEnvironmentInput = {
    ambient_temperature_c: validated.data.ambient_temperature_c ?? null,
    track_temperature_c: validated.data.track_temperature_c ?? null,
    humidity_percent: validated.data.humidity_percent ?? null,
    weather_condition: validated.data.weather_condition ?? null,
    surface_condition: validated.data.surface_condition ?? null,
    source: 'manual',
  };
  const hasEnvironment = Object.values(environment).some((value) => {
    if (typeof value === 'number') return Number.isFinite(value);
    return typeof value === 'string' && value.trim() !== '' && value !== 'manual';
  });

  try {
    const result = await generateDayPlan({
      vehicle,
      targetDate: validated.data.target_date ?? todayIso(),
      trackName: validated.data.track_name,
      environment: hasEnvironment ? environment : null,
      recentSessions,
      raceEngineerContext: buildContext({
        recentSessions,
        memory,
        feedback,
        hasEnvironment,
      }),
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
    if (err instanceof UpstreamTimeoutError) {
      return errorResponse(504, 'The day-plan service timed out. Please retry.', requestId);
    }
    console.error('[ai/day-plan]', err);
    return errorResponse(500, 'Unable to generate a day plan right now.', requestId);
  }
}
