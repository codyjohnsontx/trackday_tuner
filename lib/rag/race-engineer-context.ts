import type { createClient } from '@/lib/supabase/server';
import type {
  AiRecommendation,
  Json,
  RaceEngineerMemory,
  Session,
  SessionEnvironment,
  SessionFeedback,
  TelemetrySummary,
} from '@/types';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface ScoredSession {
  session: Session;
  score: number;
  reasons: string[];
  environment: SessionEnvironment | null;
}

export interface RaceEngineerContext {
  similarSessions: ScoredSession[];
  sessionEnvironment: SessionEnvironment | null;
  recentFeedback: SessionFeedback[];
  recentRecommendations: AiRecommendation[];
  memory: RaceEngineerMemory | null;
  telemetrySummary: TelemetrySummary | null;
  dayTrend: string;
  dataUsed: {
    manual: boolean;
    weather: boolean;
    history: boolean;
    feedback: boolean;
    telemetry: boolean;
  };
}

export interface RaceEngineerContextInput {
  userId: string;
  session: Session;
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function pressureScore(current: string, candidate: string, label: string): [number, string | null] {
  const currentPressure = parseNumber(current);
  const candidatePressure = parseNumber(candidate);
  if (currentPressure == null || candidatePressure == null) return [0, null];
  const delta = Math.abs(currentPressure - candidatePressure);
  if (delta <= 0.5) return [2, `${label} pressure within 0.5`];
  if (delta <= 1) return [1, `${label} pressure within 1.0`];
  return [0, null];
}

function environmentFor(
  sessionId: string,
  environments: SessionEnvironment[],
): SessionEnvironment | null {
  return environments.find((env) => env.session_id === sessionId) ?? null;
}

export function selectSimilarSessions(params: {
  current: Session;
  candidates: Session[];
  environments?: SessionEnvironment[];
  limit?: number;
}): ScoredSession[] {
  const environments = params.environments ?? [];
  const currentEnv = environmentFor(params.current.id, environments);

  return params.candidates
    .filter((candidate) => candidate.id !== params.current.id)
    .map((candidate) => {
      const candidateEnv = environmentFor(candidate.id, environments);
      const reasons: string[] = [];
      let score = 0;

      const sameTrackId = params.current.track_id && params.current.track_id === candidate.track_id;
      const sameTrackName =
        !sameTrackId &&
        normalize(params.current.track_name) !== '' &&
        normalize(params.current.track_name) === normalize(candidate.track_name);
      if (sameTrackId || sameTrackName) {
        score += 4;
        reasons.push('same track');
      }

      if (params.current.conditions === candidate.conditions) {
        score += 1;
        reasons.push('same condition label');
      }

      const currentFrontCompound = normalize(params.current.tires.front.compound);
      const candidateFrontCompound = normalize(candidate.tires.front.compound);
      if (currentFrontCompound && currentFrontCompound === candidateFrontCompound) {
        score += 1;
        reasons.push('matching front compound');
      }

      const currentRearCompound = normalize(params.current.tires.rear.compound);
      const candidateRearCompound = normalize(candidate.tires.rear.compound);
      if (currentRearCompound && currentRearCompound === candidateRearCompound) {
        score += 1;
        reasons.push('matching rear compound');
      }

      for (const [deltaScore, reason] of [
        pressureScore(params.current.tires.front.pressure, candidate.tires.front.pressure, 'front'),
        pressureScore(params.current.tires.rear.pressure, candidate.tires.rear.pressure, 'rear'),
      ]) {
        score += deltaScore;
        if (reason) reasons.push(reason);
      }

      if (
        currentEnv?.ambient_temperature_c != null &&
        candidateEnv?.ambient_temperature_c != null
      ) {
        const ambientDelta = Math.abs(
          currentEnv.ambient_temperature_c - candidateEnv.ambient_temperature_c,
        );
        if (ambientDelta <= 5) {
          score += 2;
          reasons.push('similar ambient temperature');
        } else if (ambientDelta <= 10) {
          score += 1;
          reasons.push('nearby ambient temperature');
        }
      }

      const timeBias = candidate.date <= params.current.date ? 0.25 : 0;
      return {
        session: candidate,
        score: score + timeBias,
        reasons,
        environment: candidateEnv,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.session.date.localeCompare(a.session.date))
    .slice(0, params.limit ?? 6);
}

function hasManualSessionData(session: Session): boolean {
  return Boolean(
    session.notes?.trim() ||
      session.tires.front.pressure.trim() ||
      session.tires.rear.pressure.trim() ||
      session.suspension.front.rebound.trim() ||
      session.suspension.rear.rebound.trim(),
  );
}

function buildDayTrend(
  current: Session,
  currentEnv: SessionEnvironment | null,
  similar: ScoredSession[],
): string {
  if (!currentEnv) {
    return 'No environment snapshot is logged for this session; use hot pressures and rider feel as the main signal.';
  }

  const previousToday = similar.find(
    (item) =>
      item.session.date === current.date &&
      item.environment?.ambient_temperature_c != null &&
      currentEnv.ambient_temperature_c != null,
  );

  if (previousToday?.environment?.ambient_temperature_c != null && currentEnv.ambient_temperature_c != null) {
    const delta = currentEnv.ambient_temperature_c - previousToday.environment.ambient_temperature_c;
    if (Math.abs(delta) >= 3) {
      const direction = delta > 0 ? 'warmer' : 'cooler';
      return `Ambient is ${Math.abs(delta).toFixed(1)} C ${direction} than a comparable session today; expect tire pressures and grip to move with the track temperature.`;
    }
  }

  if (
    currentEnv.ambient_temperature_c != null &&
    current.start_time &&
    current.start_time >= '11:00'
  ) {
    return 'This is a later-day session with ambient temperature logged; re-check hot pressures because the track may keep warming.';
  }

  if (currentEnv.track_temperature_c != null) {
    return 'Track temperature is logged, so use hot pressure and grip change as primary day-trend checks.';
  }

  return 'Environment is logged manually; treat temperature-based predictions as directional and verify hot-off-track.';
}

function compactContextSnapshot(context: RaceEngineerContext): Json {
  return {
    data_used: context.dataUsed,
    day_trend: context.dayTrend,
    similar_sessions: context.similarSessions.map((item) => ({
      session_id: item.session.id,
      score: item.score,
      reasons: item.reasons,
    })),
    memory_id: context.memory?.id ?? null,
    telemetry_summary_id: context.telemetrySummary?.id ?? null,
  };
}

export function createRecommendationSnapshot(context: RaceEngineerContext): Json {
  return compactContextSnapshot(context);
}

export async function loadRaceEngineerContext(
  supabase: SupabaseClient,
  input: RaceEngineerContextInput,
): Promise<RaceEngineerContext> {
  const { session, userId } = input;

  const { data: candidateRows } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('vehicle_id', session.vehicle_id)
    .neq('id', session.id)
    .order('date', { ascending: false })
    .order('start_time', { ascending: false, nullsFirst: false })
    .limit(30);

  const candidates = (candidateRows ?? []) as Session[];
  const sessionIds = [session.id, ...candidates.map((candidate) => candidate.id)];

  const [
    environmentResult,
    feedbackResult,
    recommendationResult,
    memoryResult,
    telemetryResult,
  ] = await Promise.all([
    supabase
      .from('session_environment')
      .select('*')
      .eq('user_id', userId)
      .in('session_id', sessionIds),
    supabase
      .from('session_feedback')
      .select('*')
      .eq('user_id', userId)
      .eq('vehicle_id', session.vehicle_id)
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('ai_recommendations')
      .select('*')
      .eq('user_id', userId)
      .eq('vehicle_id', session.vehicle_id)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('race_engineer_memory')
      .select('*')
      .eq('user_id', userId)
      .eq('vehicle_id', session.vehicle_id)
      .or(`track_id.eq.${session.track_id ?? '00000000-0000-0000-0000-000000000000'},track_id.is.null`)
      .order('track_id', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .limit(1),
    supabase
      .from('telemetry_summaries')
      .select('*')
      .eq('user_id', userId)
      .eq('session_id', session.id)
      .limit(1),
  ]);

  const environments = (environmentResult.data ?? []) as SessionEnvironment[];
  const sessionEnvironment = environmentFor(session.id, environments);
  const similarSessions = selectSimilarSessions({
    current: session,
    candidates,
    environments,
    limit: 6,
  });
  const recentFeedback = (feedbackResult.data ?? []) as SessionFeedback[];
  const recentRecommendations = (recommendationResult.data ?? []) as AiRecommendation[];
  const memory = ((memoryResult.data ?? [])[0] ?? null) as RaceEngineerMemory | null;
  const telemetrySummary = ((telemetryResult.data ?? [])[0] ?? null) as TelemetrySummary | null;

  const dayTrend = buildDayTrend(session, sessionEnvironment, similarSessions);

  return {
    similarSessions,
    sessionEnvironment,
    recentFeedback,
    recentRecommendations,
    memory,
    telemetrySummary,
    dayTrend,
    dataUsed: {
      manual: hasManualSessionData(session),
      weather: Boolean(sessionEnvironment),
      history: similarSessions.length > 0,
      feedback: recentFeedback.length > 0 || recentRecommendations.some((r) => r.status !== 'proposed'),
      telemetry: Boolean(telemetrySummary),
    },
  };
}
