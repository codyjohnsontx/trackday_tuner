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
  courseMatchRank,
} from '@/lib/session-compare';
import { fetchPreviousSession } from '@/lib/session-previous';
import { SESSION_DELETE_FAILED_MESSAGE, SESSION_DELETE_NOT_FOUND_MESSAGE } from '@/lib/session-delete';
import { reportError } from '@/lib/monitoring/report-error';
import { createClient } from '@/lib/supabase/server';
import { getUserProfile } from '@/lib/actions/vehicles';
import { resolveUserAccess } from '@/lib/access';
import { validateLaps } from '@/lib/lap-times';
import { sessionIsAtTrack, trackNameSearchPattern } from '@/lib/session-track';
import { createSessionForUser, persistSessionLaps } from '@/lib/sessions/create';
import type {
  ActionResult,
  CreateSessionInput,
  CreateSessionLapInput,
  Session,
  SessionEnvironment,
  SessionLap,
  TelemetrySummary,
} from '@/types';

const SESSION_LAPS_SAVE_FAILED_MESSAGE =
  'Your lap times were not saved - something is wrong on our end, not with what you entered. They are still on this page: copy them somewhere safe before you leave, then try again in a few minutes.';

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

const RECENT_TRACK_SESSION_LIMIT = 10;
const TRACK_NAME_PAGE_SIZE = 100;

/**
 * The rider's most recent sessions at one track, newest first, at most
 * `RECENT_TRACK_SESSION_LIMIT` of them.
 *
 * Two reads rather than one `or(...)`: a track name is free text that can hold
 * the commas and parentheses PostgREST's `or` grammar reserves. The name read is
 * for sessions saved before every typed circuit was linked to a track row; its
 * pattern only narrows and `sessionIsAtTrack` decides, so it is paged until it
 * has found enough real matches rather than capped - a cap there would let rows
 * the fold rejects crowd out the ones it accepts.
 *
 * A failed read is reported rather than returned as `[]`, which the track page
 * would print as "no sessions here yet" to a rider who has logged a season there.
 */
export async function getSessionsAtTrack(track: { id: string; name: string }): Promise<ActionResult<Session[]>> {
  if (await isDemoMode()) {
    return {
      ok: true,
      data: getDemoSessions()
        .filter((session) => sessionIsAtTrack(session, track))
        .slice(0, RECENT_TRACK_SESSION_LIMIT),
    };
  }

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();
  const orderedSessions = () =>
    supabase
      .from('sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .order('start_time', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

  const readUnlinkedByName = async () => {
    const matches: Session[] = [];
    for (let from = 0; matches.length < RECENT_TRACK_SESSION_LIMIT; from += TRACK_NAME_PAGE_SIZE) {
      const { data, error } = await orderedSessions()
        .is('track_id', null)
        .ilike('track_name', trackNameSearchPattern(track.name))
        .range(from, from + TRACK_NAME_PAGE_SIZE - 1);
      if (error) return { data: null, error };
      const page = (data ?? []) as Session[];
      matches.push(...page.filter((session) => sessionIsAtTrack(session, track)));
      if (page.length < TRACK_NAME_PAGE_SIZE) break;
    }
    return { data: matches, error: null };
  };

  const [byId, byName] = await Promise.all([
    orderedSessions().eq('track_id', track.id).limit(RECENT_TRACK_SESSION_LIMIT),
    readUnlinkedByName(),
  ]);

  const error = byId.error ?? byName.error;
  if (error) {
    reportError('track-sessions', new Error(error.message), {
      reason: error.code,
      table: 'sessions',
      details: error.details,
      hint: error.hint,
      userId: user.id,
    });
    return { ok: false, error: 'Your sessions at this track could not be loaded. Try again in a moment.' };
  }

  const sessions = [...((byId.data ?? []) as Session[]), ...(byName.data ?? [])]
    .filter((session) => sessionIsAtTrack(session, track))
    .sort(compareSessionsDesc)
    .slice(0, RECENT_TRACK_SESSION_LIMIT);
  return { ok: true, data: sessions };
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

/**
 * A session's weather readings, `null` when none were logged. A failed read is
 * reported rather than returned as `null`, which the session delete
 * confirmation would read as "no weather readings to lose".
 */
export async function getSessionEnvironment(sessionId: string): Promise<ActionResult<SessionEnvironment | null>> {
  if (await isDemoMode()) {
    return { ok: true, data: getDemoSessionEnvironment(sessionId) };
  }

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('session_environment')
    .select('*')
    .eq('session_id', sessionId)
    .eq('user_id', user.id)
    .limit(1);

  if (error) {
    console.error('[sessions] session-environment query failed', { userId: user.id, sessionId, error: error.message });
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data?.[0] ?? null) as SessionEnvironment | null };
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
    const rank = courseMatchRank(a, currentSession) - courseMatchRank(b, currentSession);
    if (rank !== 0) return rank;
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

/**
 * The rider's laps for a session, or the reason they could not be read.
 *
 * The two answers have to stay distinguishable all the way to the panel, which
 * is why this reports a failure instead of returning an empty list. An empty
 * list is a claim - "this session holds no laps" - and `SessionLapsPanel` acts
 * on it by offering "Add Lap Times". The save behind that button calls
 * `replace_session_laps`, which deletes every lap on the session before
 * inserting and has no minimum in `validateLaps`, so a rider who believed the
 * claim and retyped what they remembered destroyed the rest of their times. The
 * read failing was the only thing that ever went wrong; the rider's own
 * recovery was what lost the data.
 *
 * Logging the error is not the fix and was never enough on its own - a server
 * log does not reach the rider standing in front of an empty editor - so the
 * failure is a value the caller has to handle. It is logged as well, because
 * the operator wants to know the read is failing at all.
 */
export async function getSessionLaps(sessionId: string): Promise<ActionResult<SessionLap[]>> {
  if (await isDemoMode()) {
    const summary = getDemoTelemetrySummaries([sessionId])[0];
    const times = summary?.metrics.lap_times_ms ?? [];
    return {
      ok: true,
      data: times.map((lapTime, index) => ({
        id: `demo-lap-${sessionId}-${index + 1}`,
        user_id: '00000000-0000-0000-0000-000000000001',
        session_id: sessionId,
        lap_number: index + 1,
        lap_time_ms: lapTime,
        included: true,
        source: 'manual',
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      })),
    };
  }

  const user = await getRealUser();
  // Not "this session has no laps": with no rider there is nobody whose laps
  // these are, and answering with an empty list would put the panel back in
  // front of the destructive save. Every unknown resolves the same way here.
  if (!user) return { ok: false, error: 'Not authenticated.' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('session_laps')
    .select('*')
    .eq('user_id', user.id)
    .eq('session_id', sessionId)
    .order('lap_number');

  if (error) {
    console.error('[sessions] session-laps query failed', {
      userId: user.id,
      sessionId,
      error: error.message,
    });
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? []) as SessionLap[] };
}

export async function createSession(
  input: CreateSessionInput,
): Promise<ActionResult<Session>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();

  const result = await createSessionForUser(
    {
      supabase,
      userId: user.id,
      resolveProAccess: async () => resolveUserAccess(await getUserProfile()).hasProAccess,
      report: reportError,
    },
    input,
  );
  if (!result.ok) return result;

  revalidatePath('/sessions');
  revalidatePath('/dashboard');
  if (result.data.createdTrack) {
    // The tracks list, the track's own page and the picker that will fill this
    // field next time all read the row just written.
    revalidateTag('tracks');
    revalidatePath('/tracks');
    revalidatePath('/sessions/new');
  }
  return { ok: true, data: result.data.session };
}

/**
 * Replace a session's laps with the set the rider is looking at.
 *
 * `expectedLaps` is the set the caller read before the rider edited it. It is
 * passed through to `replace_session_laps`, which refuses the delete unless the
 * stored laps ARE that set - lap numbers, lap times and `included` flags alike.
 * So a save built on a read that returned no laps cannot replace a session that
 * holds some, and neither can a second tab whose snapshot has the same number of
 * laps as the one the first tab just edited. See 20260903001500 for what a lap
 * set's identity is and why it is derived rather than stored, and
 * `getSessionLaps` for how the read itself is reported.
 *
 * Nothing is returned but success: the caller already holds the laps it just
 * sent, and reading them back would only add a second read that can fail after
 * the write is committed.
 */
export async function replaceSessionLaps(
  sessionId: string,
  laps: CreateSessionLapInput[],
  expectedLaps: CreateSessionLapInput[],
): Promise<ActionResult> {
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
    report: reportError,
    userId: user.id,
    session: sessionRow as Session,
    laps,
    expectedLaps,
    saveFailedMessage: SESSION_LAPS_SAVE_FAILED_MESSAGE,
  });
  if (persistError) return { ok: false, error: persistError };

  revalidatePath(`/sessions/${sessionId}`);
  return { ok: true, data: undefined };
}

export async function deleteSession(id: string): Promise<ActionResult> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();
  // The deleted rows are selected back because RLS and the user_id filter turn
  // another rider's id, or one already gone, into zero rows rather than an error.
  // Without the count that is a success the page would navigate away on.
  const { data, error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id');

  if (error) {
    reportError('session-delete', new Error(error.message), {
      reason: error.code,
      table: 'sessions',
      details: error.details,
      hint: error.hint,
      userId: user.id,
      sessionId: id,
    });
    return { ok: false, error: SESSION_DELETE_FAILED_MESSAGE };
  }
  if ((data ?? []).length === 0) return { ok: false, error: SESSION_DELETE_NOT_FOUND_MESSAGE };

  revalidatePath('/sessions');
  revalidatePath('/dashboard');
  revalidatePath(`/sessions/${id}`);
  return { ok: true, data: undefined };
}
