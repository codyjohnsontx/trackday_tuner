'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { getRealUser } from '@/lib/auth';
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
import { fetchPreviousSession } from '@/lib/session-previous';
import { createClient } from '@/lib/supabase/server';
import { getUserProfile } from '@/lib/actions/vehicles';
import { getFreePlanLimit, getFreePlanLimitMessage } from '@/lib/plans';
import { resolveUserAccess } from '@/lib/access';
import { validateLaps } from '@/lib/lap-times';
import { MISSING_CONDITIONS_MESSAGE, isSessionCondition } from '@/lib/session-answers';
import {
  MISSING_TRACK_MESSAGE,
  TRACK_NAME_MATCH_LIMIT,
  findSavedTrackByName,
  hasTrackName,
  normalizeTrackName,
  trackNameExactPattern,
  trackNameSearchPattern,
} from '@/lib/session-track';
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

/**
 * Undo the track row `resolveSessionTrack` wrote, when the session it was written
 * for does not survive.
 *
 * The track is inserted before the session so the session can link to it, so
 * every failure path after that point would otherwise leave a circuit in the
 * rider's tracks list for a session that was never saved - and burn one of a free
 * rider's three custom-track slots. Only a row this call created is removed;
 * anything matched or picked was already theirs.
 */
async function rollbackAutoCreatedTrack(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  track: ResolvedSessionTrack,
): Promise<void> {
  if (!track.createdTrack || !track.trackId) return;

  const { error } = await supabase
    .from('tracks')
    .delete()
    .eq('id', track.trackId)
    .eq('created_by', userId)
    .eq('is_seeded', false);

  if (error) {
    console.error('[sessions] auto-created track rollback failed', {
      userId,
      trackId: track.trackId,
      error: error.message,
    });
  }
}

/**
 * Undo a session row that did not survive the writes that follow it.
 *
 * The auto-created track only goes with it when the session row actually went.
 * `sessions.track_id` is `on delete set null`, so deleting the track from under a
 * session the delete left behind strips the circuit off a row the rider still
 * has - silently, and on a save this action already reported as failed. A stray
 * track is the lesser of the two, so a refused delete keeps it.
 */
async function rollbackCreatedSession(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  sessionId: string;
  track: ResolvedSessionTrack;
  failureLog: string;
}): Promise<void> {
  const { data, error } = await params.supabase
    .from('sessions')
    .delete()
    .eq('id', params.sessionId)
    .eq('user_id', params.userId)
    .select('id');

  // RLS turns a row this delete may not touch into zero rows deleted rather than
  // an error, so silence is not proof the session went - and the track may only
  // follow a session that did. See deleteSagEntry in lib/actions/sag.ts.
  if (error || !data || data.length === 0) {
    console.error(params.failureLog, {
      userId: params.userId,
      sessionId: params.sessionId,
      error: error?.message ?? 'no rows deleted',
    });
    return;
  }

  await rollbackAutoCreatedTrack(params.supabase, params.userId, params.track);
}

export async function getSessions(vehicleId?: string, limit?: number): Promise<Session[]> {
  if (await isDemoMode()) {
    return getDemoSessions(vehicleId, limit);
  }

  const user = await getRealUser();
  if (!user) return [];

  const supabase = await createClient();
  // Mirrors compareSessionsDesc: date, then start_time with NULL treated as the
  // earliest time of the day (so "nulls last" in a descending sort), then created_at.
  // Ordering on date alone ties every session of a track day together, and the tie
  // break is whatever the planner emits - which put a rider's morning warm-up at the
  // top of their history and left the session they just finished off the dashboard's
  // three-row "Recent" list entirely.
  let query = supabase
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .order('start_time', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

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

  const user = await getRealUser();
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

  const user = await getRealUser();
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

  const user = await getRealUser();
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

  const user = await getRealUser();
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

  const user = await getRealUser();
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

  const user = await getRealUser();
  if (!user) return null;

  const supabase = await createClient();

  return fetchPreviousSession(supabase, user.id, currentSession);
}

export async function getComparableSessions(currentSession: Session): Promise<Session[]> {
  if (await isDemoMode()) {
    return getDemoComparableSessions(currentSession);
  }

  const user = await getRealUser();
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

  const user = await getRealUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('telemetry_summaries')
    .select('*')
    .eq('user_id', user.id)
    .in('session_id', sessionIds);

  if (error) {
    // A discarded read renders as `Laps 0`, `lap times 0 (0%)` and "No lap
    // times logged yet." on the Pro analytics panel - exactly what a rider who
    // logged no laps sees - so nobody can tell a failed read from an empty one
    // unless it says so here. Returning the empty list rather than throwing
    // keeps the rest of the page, which does not depend on laps, on screen.
    console.error('[sessions] telemetry-summaries query failed', {
      userId: user.id,
      sessionCount: sessionIds.length,
      error: error.message,
    });
  }

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

  const user = await getRealUser();
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

/** Which track row a session belongs to, and the name stored alongside it. */
interface ResolvedSessionTrack {
  trackId: string | null;
  trackName: string | null;
  /** A new `tracks` row was written, so the tracks list changed. */
  createdTrack: boolean;
}

/**
 * The tracks a rider can reach: the seeded ones plus their own, which is the list
 * the form's picker offers. Written once because the id lookup and the typed-name
 * search have to ask for the same set - an id resolving in a scope the name search
 * does not use is exactly the id/name divergence `resolveSessionTrack` closes.
 */
function visibleTracksFilter(userId: string): string {
  return `is_seeded.eq.true,created_by.eq.${userId}`;
}

/**
 * What a name lookup found, including the case where it cannot say.
 *
 * `unproven` is the one that matters. A read that failed, and a read that came
 * back full, both leave the question open - and the caller's next move on an open
 * question must not be the insert, because a circuit the rider already has would
 * get a second row and spend one of a free rider's three slots.
 */
type VisibleTrackLookup =
  | { status: 'found'; track: { id: string; name: string } }
  | { status: 'absent' }
  | { status: 'unproven'; log: string; detail: Record<string, unknown> };

/**
 * The saved track a typed name means, looked for in the database rather than read
 * whole and folded here.
 *
 * Two queries, narrowest first. The exact pattern answers a rider retyping a
 * circuit they have logged before and cannot be widened by how the name is
 * spelled, so the ordinary case never depends on the bound at all. Only when that
 * misses does the wildcard pattern go looking for the spellings the fold accepts
 * but `like` does not - doubled spacing, a decomposed accent, a stored row that
 * was never trimmed - and that pattern can be broad enough to match a great many
 * rows.
 *
 * Which is why reaching the limit is `unproven` and not `absent`. The rows come
 * back ordered so the same request cannot answer differently twice, and
 * `findSavedTrackByName` still decides on whatever came back.
 */
async function findVisibleTrackByName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  typed: string,
): Promise<VisibleTrackLookup> {
  const exact = trackNameExactPattern(typed);
  const wildcard = trackNameSearchPattern(typed);
  const patterns = wildcard === exact ? [exact] : [exact, wildcard];

  for (const pattern of patterns) {
    const { data, error } = await supabase
      .from('tracks')
      .select('id, name')
      .or(visibleTracksFilter(userId))
      .ilike('name', pattern)
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .limit(TRACK_NAME_MATCH_LIMIT);

    if (error) {
      return {
        status: 'unproven',
        log: '[sessions] visible tracks lookup failed',
        detail: { userId, error: error.message },
      };
    }

    const rows = (data ?? []) as { id: string; name: string }[];
    const matched = findSavedTrackByName(typed, rows);
    if (matched) return { status: 'found', track: matched };

    if (rows.length >= TRACK_NAME_MATCH_LIMIT) {
      return {
        status: 'unproven',
        log: '[sessions] visible tracks lookup truncated',
        detail: { userId, trackName: typed, pattern, limit: TRACK_NAME_MATCH_LIMIT },
      };
    }
  }

  return { status: 'absent' };
}

/**
 * The circuit a session names, resolved to a track row.
 *
 * A name the rider typed is matched against the tracks they can already see, and
 * saved as a track of their own when it matches none - otherwise `track_id` stays
 * null forever and the session is missing from /tracks, from the track page, and
 * from anything that groups by track id. See lib/session-track.ts.
 *
 * Creating the row is never allowed to fail the save. A free rider already at
 * their custom-track limit, or an insert that errors, falls back to the name-only
 * session this app has always stored, which every read surface still matches by
 * name.
 */
async function resolveSessionTrack(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  hasProAccess: boolean,
  trackId: string | null,
  trackName: string | null,
): Promise<ResolvedSessionTrack> {
  const typed = normalizeTrackName(trackName);

  if (trackId) {
    // The id is resolved rather than trusted. A `track_id` the rider cannot see
    // still satisfies the foreign key, and storing the typed name beside it
    // would persist a session whose id and name name different circuits. The
    // row's own name is the canonical one, so it wins over what was typed.
    const { data, error } = await supabase
      .from('tracks')
      .select('id, name')
      .eq('id', trackId)
      .or(visibleTracksFilter(userId))
      .maybeSingle();

    if (error) {
      // A failed query is not an invisible row. Falling through here would
      // create a second row for a circuit the rider already has and spend one of
      // their custom-track slots on it, so the id they picked is kept instead.
      console.error('[sessions] track lookup failed', { userId, trackId, error: error.message });
      return { trackId, trackName: typed, createdTrack: false };
    }

    const resolvedName = normalizeTrackName((data as { name?: string } | null)?.name);
    if (data && resolvedName) return { trackId, trackName: resolvedName, createdTrack: false };
    // Unreachable or unknown id: fall through and resolve the typed name instead
    // of saving a link the rider cannot follow.
  }

  if (!typed) return { trackId: null, trackName: null, createdTrack: false };

  // A name typed out in full lands on the row it names rather than beside it.
  const lookup = await findVisibleTrackByName(supabase, userId, typed);

  if (lookup.status === 'unproven') {
    // An answer the lookup could not give is not the answer "no such circuit". A
    // failed select and a truncated one both look exactly like a track the rider
    // has never logged, and creating one would duplicate a track they already
    // have. The session still saves under the typed name, which every read
    // surface still matches - a missing link is recoverable and a second row on a
    // three-slot plan is not.
    console.error(lookup.log, lookup.detail);
    return { trackId: null, trackName: typed, createdTrack: false };
  }

  if (lookup.status === 'found') {
    return { trackId: lookup.track.id, trackName: lookup.track.name, createdTrack: false };
  }

  if (!hasProAccess) {
    const { count } = await supabase
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', userId)
      .eq('is_seeded', false);

    if ((count ?? 0) >= getFreePlanLimit('tracks')) {
      return { trackId: null, trackName: typed, createdTrack: false };
    }
  }

  const { data: created, error } = await supabase
    .from('tracks')
    .insert({ name: typed, location: null, is_seeded: false, created_by: userId })
    .select('id, name')
    .single();

  if (error || !created) {
    console.error('[sessions] track auto-save failed', {
      userId,
      trackName: typed,
      error: error?.message ?? 'no row returned',
    });
    return { trackId: null, trackName: typed, createdTrack: false };
  }

  return { trackId: created.id, trackName: created.name, createdTrack: true };
}

export async function createSession(
  input: CreateSessionInput,
): Promise<ActionResult<Session>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();

  const lapValidationError = validateLaps(input.laps ?? []);
  if (lapValidationError) return { ok: false, error: lapValidationError };

  // The same rule the form checks. `sessions.conditions` is NOT NULL, so a
  // session with no weather answer has to be refused here rather than saved
  // with whatever the form happened to open with. See lib/session-answers.ts.
  if (!isSessionCondition(input.conditions)) return { ok: false, error: MISSING_CONDITIONS_MESSAGE };

  // Track is checked here as well as on the form, and checked on the payload
  // rather than after resolution, so a refusal happens before anything is
  // written: `resolveSessionTrack` inserts a track row, and refusing after it
  // would spend one of a free rider's three custom-track slots on a session that
  // was never saved. A payload naming neither an id nor a name cannot resolve to
  // a circuit, so nothing later can rescue it. See lib/session-track.ts.
  if (!input.track_id && !hasTrackName(input.track_name)) {
    return { ok: false, error: MISSING_TRACK_MESSAGE };
  }

  const profile = await getUserProfile();
  const hasProAccess = resolveUserAccess(profile).hasProAccess;
  if (!hasProAccess) {
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

  const track = await resolveSessionTrack(supabase, user.id, hasProAccess, input.track_id, input.track_name);

  // A `track_id` the rider cannot see resolves to nothing, and with no typed name
  // beside it the session would still store no circuit. Rolling the auto-created
  // row back is unnecessary here - a resolution that created one always carries
  // its name - but it is called anyway so this guard cannot start leaking rows if
  // resolution changes.
  if (!track.trackName) {
    await rollbackAutoCreatedTrack(supabase, user.id, track);
    return { ok: false, error: MISSING_TRACK_MESSAGE };
  }

  const payload: TableInsert<'sessions'> = {
    user_id: user.id,
    vehicle_id: input.vehicle_id,
    track_id: track.trackId,
    track_name: track.trackName,
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

  if (error) {
    await rollbackAutoCreatedTrack(supabase, user.id, track);
    return { ok: false, error: error.message };
  }

  const createdSession = data as Session;

  const lapError = await persistSessionLaps({
    supabase,
    userId: user.id,
    session: createdSession,
    laps: input.laps ?? [],
  });
  if (lapError) {
    await rollbackCreatedSession({
      supabase,
      userId: user.id,
      sessionId: createdSession.id,
      track,
      failureLog: '[sessions] session rollback after lap failure failed',
    });
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
      await rollbackCreatedSession({
        supabase,
        userId: user.id,
        sessionId: createdSession.id,
        track,
        failureLog: '[sessions] session rollback failed',
      });
      return { ok: false, error: environmentError.message };
    }
  }

  // Persist deterministic change records against the previous session and the active
  // baseline. Best effort only — a failure here never fails session creation. The
  // vehicle, previous-session, and baseline lookups are independent, so run them in
  // parallel to keep this off the critical path of session creation.
  try {
    const [vehicleResult, previousSession, baselineResult] = await Promise.all([
      supabase
        .from('vehicles')
        .select('type')
        .eq('id', createdSession.vehicle_id)
        .eq('user_id', user.id)
        .single(),
      fetchPreviousSession(supabase, user.id, createdSession),
      supabase
        .from('vehicle_baselines')
        .select('*')
        .eq('user_id', user.id)
        .eq('vehicle_id', createdSession.vehicle_id)
        .limit(1),
    ]);

    const vehicleRow = vehicleResult.data;
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
  if (track.createdTrack) {
    // The tracks list, the track's own page and the picker that will fill this
    // field next time all read the row just written.
    revalidateTag('tracks');
    revalidatePath('/tracks');
    revalidatePath('/sessions/new');
  }
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

  const user = await getRealUser();
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

  const user = await getRealUser();
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
