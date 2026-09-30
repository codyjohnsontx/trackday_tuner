'use server';

import { randomUUID } from 'node:crypto';
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
import {
  SESSION_DELETE_CHANGED_AFTER_PHOTO_MESSAGE,
  SESSION_DELETE_CHANGED_MESSAGE,
  SESSION_DELETE_FAILED_AFTER_PHOTO_MESSAGE,
  SESSION_DELETE_FAILED_MESSAGE,
  SESSION_DELETE_NOT_FOUND_MESSAGE,
  SESSION_DELETE_PHOTO_FAILED_MESSAGE,
  SESSION_PHOTO_BUCKET,
  sessionPhotoObjectPath,
} from '@/lib/session-delete';
import { removeObjectsAfterDelete, removeOwnedPhotos } from '@/lib/storage-photo-removal';
import { reportError } from '@/lib/monitoring/report-error';
import { readStoredSession, readStoredSessions } from '@/lib/stored-session';
import { createClient } from '@/lib/supabase/server';
import { getUserProfile } from '@/lib/actions/vehicles';
import { resolveUserAccess } from '@/lib/access';
import { validateLaps } from '@/lib/lap-times';
import { sessionIsAtTrack, trackNameSearchPattern } from '@/lib/session-track';
import { createSessionForUser } from '@/lib/sessions/create';
import type {
  ActionResult,
  CreateSessionInput,
  CreateSessionLapInput,
  Json,
  Session,
  SessionEnvironment,
  SessionLap,
  TelemetrySummary,
} from '@/types';

const SESSION_LAPS_SAVE_FAILED_MESSAGE =
  'Your lap times were not saved - something is wrong on our end, not with what you entered. They are still on this page: copy them somewhere safe before you leave, then try again in a few minutes.';

/**
 * The SQLSTATE `replace_session_laps` raises when the laps the caller read are
 * not the laps that are stored - see 20260903001500. Matched on the code rather
 * than the message so the rider-facing sentence and the database's wording can
 * move independently.
 */
const SESSION_LAPS_STALE_READ_CODE = 'TT409';

const SESSION_LAPS_STALE_READ_MESSAGE =
  'The lap times on this session changed since this page loaded, so nothing was overwritten. Reload the session and try again.';

/**
 * The codes whose own message is written for a rider, and everything else is a
 * deployment or transport fault.
 *
 * `replace_session_laps` (20260903001500) rejects a request with a bare
 * `raise exception`, which is `P0001`, and those messages are about THIS
 * request. `TT409` is its stale-read refusal, which has a written sentence of
 * its own above. Any OTHER code answers with `SESSION_LAPS_SAVE_FAILED_MESSAGE`
 * and goes to `reportError`.
 *
 * THE DIRECTION IS THE POINT, and it is the same rule and the same reason as
 * `app/api/sessions/[id]/outcome/route.ts`. This path returned `error.message`
 * verbatim for everything but `TT409`, so a `replace_session_laps` the Data API
 * cannot resolve printed raw PostgREST parameter names under a rider's unsaved
 * lap times with nothing reaching Sentry - the Save Outcome defect exactly, on
 * the sibling RPC. A transport failure is the same hole: `postgrest-js` resolves
 * one as an ordinary error carrying an EMPTY `code`, and an unparseable body as
 * one carrying NO `code`, so neither is on any list of faults anyone thought of.
 *
 * Lap times are rider-typed data lost the same way notes are, so assume a
 * database error reaches the rider until you have read the code that stops it.
 */
const SESSION_LAPS_DOMAIN_REJECTION_CODE = 'P0001';

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
  return readStoredSessions(data);
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
      const page = readStoredSessions(data);
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

  const sessions = [...readStoredSessions(byId.data), ...(byName.data ?? [])]
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
  for (const row of readStoredSessions(data)) {
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
  return readStoredSession(data);
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

  return readStoredSessions(data).sort((a, b) => {
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
    // Minted here, per save, so the form writes through the same atomic
    // `create_session_with_laps` as the phone - one write, and one free-plan cap
    // counted under the rider's lock - while a browser still cannot choose a
    // row's primary key.
    { id: randomUUID(), replayable: false },
  );
  // `kind` is for callers answering with a status; this one shows the sentence.
  if (!result.ok) return { ok: false, error: result.error };
  // A fresh id names no deleted session, so this is only the type's other arm.
  if (result.data.deleted) return { ok: false, error: 'This session was already deleted.' };

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

  const { error } = await supabase.rpc('replace_session_laps', {
    p_user_id: user.id,
    p_session_id: sessionRow.id,
    p_laps: laps as unknown as Json,
    p_expected_laps: expectedLaps as unknown as Json,
  });
  if (error) {
    if (error.code === SESSION_LAPS_STALE_READ_CODE) return { ok: false, error: SESSION_LAPS_STALE_READ_MESSAGE };
    if (error.code === SESSION_LAPS_DOMAIN_REJECTION_CODE) return { ok: false, error: error.message };
    reportError('session-laps', new Error(error.message), {
      reason: error.code,
      query: 'replace_session_laps',
      details: error.details,
      hint: error.hint,
    });
    return { ok: false, error: SESSION_LAPS_SAVE_FAILED_MESSAGE };
  }

  revalidatePath(`/sessions/${sessionId}`);
  return { ok: true, data: undefined };
}

export async function deleteSession(id: string): Promise<ActionResult<{ sessionPhotoCleanupFailed: boolean }>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();
  const reportDeleteError = (error: { message: string; code?: string; details?: string; hint?: string }) =>
    reportError('session-delete', new Error(error.message), {
      reason: error.code,
      table: 'sessions',
      details: error.details,
      hint: error.hint,
      userId: user.id,
      sessionId: id,
    });

  // The photo goes first (owner's decision, 2026-09-26). The bucket is public,
  // so deleting the row and then failing to remove the photo would leave it
  // online with nothing pointing at it and no way for the rider to retry. Read
  // the row, remove its photo, and delete only once Storage has confirmed.
  const { data: row, error: readError } = await supabase
    .from('sessions')
    .select('id, photo_url')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (readError) {
    reportDeleteError(readError);
    return { ok: false, error: SESSION_DELETE_FAILED_MESSAGE };
  }
  if (!row) return { ok: false, error: SESSION_DELETE_NOT_FOUND_MESSAGE };
  const photoUrl = (row as { id: string; photo_url: string | null }).photo_url;

  const photoRemoved = await removeOwnedPhotos(supabase, {
    bucket: SESSION_PHOTO_BUCKET,
    photoUrls: [photoUrl],
    ownerId: user.id,
    event: 'session-photo-delete',
    context: { sessionId: id },
  });
  if (!photoRemoved) return { ok: false, error: SESSION_DELETE_PHOTO_FAILED_MESSAGE };

  // Deleted only while `photo_url` is still the one just read, so a photo synced
  // in between under a different URL keeps the row. A phone replacing the photo
  // at the same path, or giving a photo-less session its first one, does not
  // change what was read; the removal after the delete is what catches those.
  // The rows are selected back because RLS and the user_id filter turn a row
  // already gone, or one whose photo moved, into zero rows rather than an error.
  const deleteQuery = supabase.from('sessions').delete().eq('id', id).eq('user_id', user.id);
  const { data, error } = await (photoUrl === null
    ? deleteQuery.is('photo_url', null)
    : deleteQuery.eq('photo_url', photoUrl)
  ).select('id');

  if (error) {
    reportDeleteError(error);
    return { ok: false, error: photoUrl === null ? SESSION_DELETE_FAILED_MESSAGE : SESSION_DELETE_FAILED_AFTER_PHOTO_MESSAGE };
  }
  const deleted = (data ?? []) as { id: string }[];
  if (deleted.length === 0) {
    return { ok: false, error: photoUrl === null ? SESSION_DELETE_CHANGED_MESSAGE : SESSION_DELETE_CHANGED_AFTER_PHOTO_MESSAGE };
  }

  const photoSwept = await removeObjectsAfterDelete(supabase, {
    bucket: SESSION_PHOTO_BUCKET,
    objects: deleted.map((session) => sessionPhotoObjectPath(user.id, session.id)),
    ownerId: user.id,
    event: 'session-photo-delete',
    context: { sessionId: id },
  });

  revalidatePath('/sessions');
  revalidatePath('/dashboard');
  revalidatePath(`/sessions/${id}`);
  return { ok: true, data: { sessionPhotoCleanupFailed: !photoSwept } };
}
