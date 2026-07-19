'use server';

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUser } from '@/lib/auth';
import {
  getDemoComparableSessions,
  getDemoLatestSessionsByVehicle,
  getDemoPreviousSession,
  getDemoSession,
  getDemoSessionCount,
  getDemoSessionEnvironment,
  getDemoSessionEnvironments,
  getDemoSessions,
  getDemoTelemetrySummaries,
} from '@/lib/demo/data';
import { assertNotDemoMode, isDemoMode } from '@/lib/demo/mode';
import {
  COMPARABLE_SESSION_FETCH_LIMIT,
  COMPARABLE_SESSION_LIMIT,
  compareSessionsDesc,
  sessionsMatchTrack,
} from '@/lib/session-compare';
import { createClient } from '@/lib/supabase/server';
import { getUserProfile } from '@/lib/actions/vehicles';
import { getFreePlanLimit, getFreePlanLimitMessage } from '@/lib/plans';
import { resolveUserAccess } from '@/lib/access';
import { validateLaps } from '@/lib/lap-times';
import {
  baselineReferenceLabel,
  baselineToComparableSession,
  computeSetupChanges,
  sessionReferenceLabel,
} from '@/lib/session-changes';
import type { TableInsert } from '@/types/supabase';
import type {
  ActionResult,
  CreateSessionEnvironmentInput,
  CreateSessionInput,
  CreateSessionLapInput,
  Session,
  SessionEnvironment,
  SessionLap,
  TelemetrySummary,
  Json,
  VehicleBaseline,
  VehicleType,
} from '@/types';

function hasEnvironmentValues(environment: CreateSessionEnvironmentInput | null | undefined): boolean {
  if (!environment) return false;
  return [
    environment.ambient_temperature_c,
    environment.track_temperature_c,
    environment.humidity_percent,
    environment.weather_condition,
    environment.surface_condition,
  ].some((value) => {
    if (typeof value === 'number') return Number.isFinite(value);
    return Boolean(value?.trim());
  });
}

async function persistSessionLaps(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  session: Session;
  laps: CreateSessionLapInput[];
}): Promise<string | null> {
  const validationError = validateLaps(params.laps);
  if (validationError) return validationError;
  const { error } = await params.supabase.rpc('replace_session_laps', {
    p_user_id: params.userId,
    p_session_id: params.session.id,
    p_laps: params.laps as unknown as Json,
  });
  return error?.message ?? null;
}

export async function getSessions(vehicleId?: string, limit?: number): Promise<Session[]> {
  if (await isDemoMode()) {
    return getDemoSessions(vehicleId, limit);
  }

  const user = await getAuthenticatedUser();
  if (!user) return [];

  const supabase = await createClient();
  let query = supabase
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false });

  if (vehicleId) {
    query = query.eq('vehicle_id', vehicleId);
  }

  if (limit) {
    query = query.limit(limit);
  }

  const { data } = await query;
  return (data ?? []) as Session[];
}

export async function getLatestSessionsByVehicle(): Promise<Record<string, Session>> {
  if (await isDemoMode()) {
    return getDemoLatestSessionsByVehicle();
  }

  const user = await getAuthenticatedUser();
  if (!user) return {};

  const supabase = await createClient();
  const { data } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .order('start_time', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  const latest: Record<string, Session> = {};
  for (const row of (data ?? []) as Session[]) {
    if (!latest[row.vehicle_id]) {
      latest[row.vehicle_id] = row;
    }
  }

  return latest;
}

export async function getSessionCount(vehicleId?: string): Promise<number> {
  if (await isDemoMode()) {
    return getDemoSessionCount(vehicleId);
  }

  const user = await getAuthenticatedUser();
  if (!user) return 0;

  const supabase = await createClient();
  let query = supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  if (vehicleId) {
    query = query.eq('vehicle_id', vehicleId);
  }

  const { count } = await query;
  return count ?? 0;
}

export async function getSession(id: string): Promise<Session | null> {
  if (await isDemoMode()) {
    return getDemoSession(id);
  }

  const user = await getAuthenticatedUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error) return null;
  return data as Session;
}

export async function getSessionEnvironment(sessionId: string): Promise<SessionEnvironment | null> {
  if (await isDemoMode()) {
    return getDemoSessionEnvironment(sessionId);
  }

  const user = await getAuthenticatedUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from('session_environment')
    .select('*')
    .eq('session_id', sessionId)
    .eq('user_id', user.id)
    .limit(1);

  return (data?.[0] ?? null) as SessionEnvironment | null;
}

export async function getSessionEnvironments(sessionIds: string[]): Promise<SessionEnvironment[]> {
  if (await isDemoMode()) {
    return getDemoSessionEnvironments(sessionIds);
  }

  const user = await getAuthenticatedUser();
  if (!user || sessionIds.length === 0) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from('session_environment')
    .select('*')
    .eq('user_id', user.id)
    .in('session_id', sessionIds);

  return (data ?? []) as SessionEnvironment[];
}

export async function getPreviousSession(
  currentSession: Session,
): Promise<Session | null> {
  if (await isDemoMode()) {
    return getDemoPreviousSession(currentSession);
  }

  const user = await getAuthenticatedUser();
  if (!user) return null;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .eq('vehicle_id', currentSession.vehicle_id)
    .neq('id', currentSession.id)
    .or(`date.lt.${currentSession.date},and(date.eq.${currentSession.date},start_time.lt.${currentSession.start_time ?? '23:59:59'})`)
    .order('date', { ascending: false })
    .order('start_time', { ascending: false, nullsFirst: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;

  return (data?.[0] ?? null) as Session | null;
}

export async function getComparableSessions(currentSession: Session): Promise<Session[]> {
  if (await isDemoMode()) {
    return getDemoComparableSessions(currentSession);
  }

  const user = await getAuthenticatedUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .eq('vehicle_id', currentSession.vehicle_id)
    .neq('id', currentSession.id)
    .order('date', { ascending: false })
    .order('start_time', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(COMPARABLE_SESSION_FETCH_LIMIT);

  return ((data ?? []) as Session[]).sort((a, b) => {
    const aSameTrack = sessionsMatchTrack(a, currentSession);
    const bSameTrack = sessionsMatchTrack(b, currentSession);
    if (aSameTrack !== bSameTrack) return aSameTrack ? -1 : 1;
    return compareSessionsDesc(a, b);
  }).slice(0, COMPARABLE_SESSION_LIMIT);
}

export async function getTelemetrySummaries(sessionIds: string[]): Promise<TelemetrySummary[]> {
  if (sessionIds.length === 0) return [];

  if (await isDemoMode()) {
    return getDemoTelemetrySummaries(sessionIds);
  }

  const user = await getAuthenticatedUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from('telemetry_summaries')
    .select('*')
    .eq('user_id', user.id)
    .in('session_id', sessionIds);

  return (data ?? []) as TelemetrySummary[];
}

export async function getSessionLaps(sessionId: string): Promise<SessionLap[]> {
  if (await isDemoMode()) {
    const summary = getDemoTelemetrySummaries([sessionId])[0];
    const times = summary?.metrics.lap_times_ms ?? [];
    return times.map((lapTime, index) => ({
      id: `demo-lap-${sessionId}-${index + 1}`,
      user_id: '00000000-0000-0000-0000-000000000001',
      session_id: sessionId,
      lap_number: index + 1,
      lap_time_ms: lapTime,
      included: true,
      source: 'manual',
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    }));
  }

  const user = await getAuthenticatedUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('session_laps')
    .select('*')
    .eq('user_id', user.id)
    .eq('session_id', sessionId)
    .order('lap_number');
  return (data ?? []) as SessionLap[];
}

export async function createSession(
  input: CreateSessionInput,
): Promise<ActionResult<Session>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();

  const lapValidationError = validateLaps(input.laps ?? []);
  if (lapValidationError) return { ok: false, error: lapValidationError };

  const profile = await getUserProfile();
  if (!resolveUserAccess(profile).hasProAccess) {
    const { count } = await supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if ((count ?? 0) >= getFreePlanLimit('sessions')) {
      return {
        ok: false,
        error: getFreePlanLimitMessage('sessions'),
      };
    }
  }

  // Denormalize track name if track_id is set but track_name was not provided
  let trackName = input.track_name;
  if (input.track_id && !trackName) {
    const { data: trackData } = await supabase
      .from('tracks')
      .select('name')
      .eq('id', input.track_id)
      .single();
    trackName = trackData?.name ?? null;
  }

  const payload: TableInsert<'sessions'> = {
    user_id: user.id,
    vehicle_id: input.vehicle_id,
    track_id: input.track_id,
    track_name: trackName,
    date: input.date,
    start_time: input.start_time ?? null,
    session_number: input.session_number ?? null,
    conditions: input.conditions,
    tires: input.tires,
    suspension: input.suspension,
    alignment: input.alignment,
    enabled_modules: input.enabled_modules ?? null,
    extra_modules: input.extra_modules ?? null,
    notes: input.notes ?? null,
  };

  const { data, error } = await supabase
    .from('sessions')
    .insert(payload)
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  const createdSession = data as Session;

  const lapError = await persistSessionLaps({
    supabase,
    userId: user.id,
    session: createdSession,
    laps: input.laps ?? [],
  });
  if (lapError) {
    const { error: rollbackError } = await supabase
      .from('sessions')
      .delete()
      .eq('id', createdSession.id)
      .eq('user_id', user.id);
    if (rollbackError) {
      console.error('[sessions] session rollback after lap failure failed', {
        userId: user.id,
        sessionId: createdSession.id,
        error: rollbackError.message,
      });
    }
    return { ok: false, error: lapError };
  }

  if (hasEnvironmentValues(input.environment)) {
    const environmentPayload: TableInsert<'session_environment'> = {
      user_id: user.id,
      session_id: createdSession.id,
      ambient_temperature_c: input.environment?.ambient_temperature_c ?? null,
      track_temperature_c: input.environment?.track_temperature_c ?? null,
      humidity_percent: input.environment?.humidity_percent ?? null,
      weather_condition: input.environment?.weather_condition?.trim() || null,
      surface_condition: input.environment?.surface_condition?.trim() || null,
      source: input.environment?.source ?? 'manual',
    };

    const { error: environmentError } = await supabase
      .from('session_environment')
      .insert(environmentPayload);

    if (environmentError) {
      console.error('[sessions] session_environment insert failed', {
        userId: user.id,
        sessionId: createdSession.id,
        error: environmentError.message,
      });
      const { error: rollbackError } = await supabase
        .from('sessions')
        .delete()
        .eq('id', createdSession.id)
        .eq('user_id', user.id);
      if (rollbackError) {
        console.error('[sessions] session rollback failed', {
          userId: user.id,
          sessionId: createdSession.id,
          error: rollbackError.message,
        });
      }
      return { ok: false, error: environmentError.message };
    }
  }

  // Persist deterministic change records against the previous session and the active
  // baseline. Best effort only — a failure here never fails session creation. The
  // vehicle, previous-session, and baseline lookups are independent, so run them in
  // parallel to keep this off the critical path of session creation.
  try {
    const [vehicleResult, previousResult, baselineResult] = await Promise.all([
      supabase
        .from('vehicles')
        .select('type')
        .eq('id', createdSession.vehicle_id)
        .eq('user_id', user.id)
        .single(),
      supabase
        .from('sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('vehicle_id', createdSession.vehicle_id)
        .neq('id', createdSession.id)
        .or(
          `date.lt.${createdSession.date},and(date.eq.${createdSession.date},start_time.lt.${createdSession.start_time ?? '23:59:59'})`,
        )
        .order('date', { ascending: false })
        .order('start_time', { ascending: false, nullsFirst: false })
        .limit(1),
      supabase
        .from('vehicle_baselines')
        .select('*')
        .eq('user_id', user.id)
        .eq('vehicle_id', createdSession.vehicle_id)
        .limit(1),
    ]);

    const vehicleRow = vehicleResult.data;
    const previousRows = previousResult.data;
    const baselineRows = baselineResult.data;

    // The vehicle type drives module resolution and is persisted into each diff, so it
    // must never be guessed. If it cannot be resolved, skip persistence and let the
    // read path derive changes later against the vehicle's real type.
    const vehicleType = (vehicleRow?.type ?? null) as VehicleType | null;
    if (!vehicleType) {
      console.error('[sessions] session_changes skipped: unresolved vehicle type', {
        userId: user.id,
        sessionId: createdSession.id,
        vehicleId: createdSession.vehicle_id,
      });
    } else {
      const previousSession = ((previousRows ?? [])[0] ?? null) as Session | null;
      const baseline = ((baselineRows ?? [])[0] ?? null) as VehicleBaseline | null;

      const changeRows: TableInsert<'session_changes'>[] = [];

      if (previousSession) {
        changeRows.push({
          user_id: user.id,
          session_id: createdSession.id,
          vehicle_id: createdSession.vehicle_id,
          reference_kind: 'previous',
          reference_session_id: previousSession.id,
          reference_label: sessionReferenceLabel(previousSession),
          reference_date: previousSession.date,
          changes: computeSetupChanges(createdSession, previousSession, vehicleType),
        });
      }

      if (baseline && baseline.source_session_id !== createdSession.id) {
        changeRows.push({
          user_id: user.id,
          session_id: createdSession.id,
          vehicle_id: createdSession.vehicle_id,
          reference_kind: 'baseline',
          reference_session_id: baseline.source_session_id,
          reference_label: baselineReferenceLabel(baseline),
          reference_date: baseline.source_date,
          changes: computeSetupChanges(createdSession, baselineToComparableSession(baseline), vehicleType),
        });
      }

      if (changeRows.length > 0) {
        const { error: changesError } = await supabase.from('session_changes').insert(changeRows);
        if (changesError) {
          console.error('[sessions] session_changes insert failed', {
            userId: user.id,
            sessionId: createdSession.id,
            error: changesError.message,
          });
        }
      }
    }
  } catch (changeTrackingError) {
    console.error('[sessions] session_changes computation failed', {
      userId: user.id,
      sessionId: createdSession.id,
      error:
        changeTrackingError instanceof Error ? changeTrackingError.message : String(changeTrackingError),
    });
  }

  revalidatePath('/sessions');
  revalidatePath('/dashboard');
  return { ok: true, data: createdSession };
}

export async function replaceSessionLaps(
  sessionId: string,
  laps: CreateSessionLapInput[],
): Promise<ActionResult<SessionLap[]>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;
  const validationError = validateLaps(laps);
  if (validationError) return { ok: false, error: validationError };

  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };
  const supabase = await createClient();
  const { data: sessionRow, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();
  if (sessionError || !sessionRow) {
    return { ok: false, error: sessionError?.message ?? 'Session not found.' };
  }

  const persistError = await persistSessionLaps({
    supabase,
    userId: user.id,
    session: sessionRow as Session,
    laps,
  });
  if (persistError) return { ok: false, error: persistError };

  revalidatePath(`/sessions/${sessionId}`);
  const updated = await getSessionLaps(sessionId);
  return { ok: true, data: updated };
}

export async function deleteSession(id: string): Promise<ActionResult> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/sessions');
  return { ok: true, data: undefined };
}
