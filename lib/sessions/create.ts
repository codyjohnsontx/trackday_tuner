import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchPreviousSession } from '@/lib/session-previous';
import { readStoredSession } from '@/lib/stored-session';
import { getFreePlanLimit, getFreePlanLimitMessage } from '@/lib/plans';
import { validateLaps } from '@/lib/lap-times';
import { MISSING_CONDITIONS_MESSAGE, isSessionCondition } from '@/lib/session-answers';
import { MISSING_TRACK_MESSAGE, hasTrackName, normalizeTrackName } from '@/lib/session-track';
import { findVisibleTrackByName, visibleTracksFilter } from '@/lib/track-lookup';
import {
  baselineReferenceLabel,
  baselineToComparableSession,
  computeSetupChanges,
  sessionReferenceLabel,
} from '@/lib/session-changes';
import type { Database, TableInsert } from '@/types/supabase';
import type {
  CreateSessionEnvironmentInput,
  CreateSessionInput,
  Session,
  Json,
  VehicleBaseline,
  VehicleType,
} from '@/types';

/**
 * Creating a session, independent of how the caller got its client and its rider.
 *
 * The server action in lib/actions/sessions.ts reads both from cookies; a caller
 * holding a bearer token builds its own client and has no cookies at all. So the
 * orchestration takes both as arguments rather than reaching for
 * `@/lib/supabase/server` and `@/lib/auth`, and there is one copy of track
 * resolution, the layout check, change records and rollbacks whichever way a
 * session arrives.
 *
 * There is one write as well. Every create carries an id - the phone mints its
 * own, the server action mints one per save - and stores the row, its laps and
 * its environment in one call to `create_session_with_laps`, which also counts
 * the free-plan session cap under a per-rider lock (20260928002300). So the cap
 * is written once, in SQL, and two saves at a free rider's last slot cannot both
 * pass whichever clients they came from.
 *
 * It is still server code - it writes as the rider through whatever client it is
 * handed and reports faults through `report` - so nothing in a browser or the
 * phone app imports it.
 */
export type SessionWriteClient = SupabaseClient<Database>;

/** `reportError` from lib/monitoring/report-error.ts, passed in rather than imported. */
export type ReportError = (scope: string, err: unknown, context?: Record<string, unknown>) => void;

export interface CreateSessionContext {
  supabase: SessionWriteClient;
  userId: string;
  /**
   * Asked only once the payload has passed every check that needs no read, so a
   * refused payload costs no profile read - the order `createSession` always had.
   */
  resolveProAccess: () => Promise<boolean>;
  report: ReportError;
}

/**
 * The created row, and whether resolving its circuit wrote a new `tracks` row -
 * which is what tells a caller the tracks list changed.
 *
 * `replayed` is true when the caller supplied an id that already names one of
 * this rider's sessions, so nothing was written and `session` is the stored row.
 *
 * `deleted` is true when that id names a session the rider has since deleted
 * (`deleted_sessions`, 20260928002300): the create was handled once already, so
 * nothing is written again and there is no row to answer with. The website mints
 * a fresh id per save, so only the phone's retries can see it.
 */
export type CreatedSession =
  | { session: Session; createdTrack: boolean; replayed: boolean; deleted: false }
  | { session: null; createdTrack: false; replayed: true; deleted: true };

/**
 * Why a create was refused, for a caller that has to answer with a status
 * rather than a sentence. The server action shows the sentence and ignores this;
 * the phone's sync engine reads it to decide between parking an entry for the
 * rider (`invalid`, `plan_limit`, `id_taken`) and retrying it later (`fault`).
 */
export type CreateSessionFailureKind = 'invalid' | 'plan_limit' | 'id_taken' | 'fault';

export type CreateSessionResult =
  | { ok: true; data: CreatedSession }
  | { ok: false; error: string; kind: CreateSessionFailureKind };

export interface CreateSessionOptions {
  /**
   * An id the caller generated for this session, which makes the create
   * idempotent: a second call carrying the same id answers with the row the
   * first one stored instead of writing another. The phone mints one per
   * session so a create replayed after a lost response cannot log the outing
   * twice; the server action mints a fresh one per save. It travels here rather
   * than inside `CreateSessionInput` so the website's server action, whose input
   * is whatever a browser posted, cannot choose a row's primary key.
   */
  id: string;
}

/**
 * The supplied id belongs to a row this rider cannot see. With v4 ids that is
 * practically never a collision, so it is a client that reused an id - nothing a
 * retry can fix, and nothing to tell the rider beyond that it did not save.
 */
export const SESSION_ID_TAKEN_MESSAGE =
  'This session could not be saved because its id is already in use. Log it again as a new session.';

/**
 * The insert named a row that is gone - a vehicle, track or layout deleted
 * between the checks and the write. No retry brings it back.
 */
export const SESSION_REFERENCE_GONE_MESSAGE =
  'This session could not be saved because the vehicle or track it was logged against no longer exists. Choose them again and save it.';

/**
 * The session named a vehicle that is not one of this rider's - deleted in
 * another tab or while the session waited on the phone, or a request that was
 * never the app's. `create_session_with_laps` refuses it as `TT404`
 * (20260927002200); this is the sentence the rider reads instead.
 */
export const SESSION_VEHICLE_NOT_OWNED_MESSAGE =
  'This session was not saved because the vehicle it names is not in your garage. Choose one of your vehicles and save it again.';

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

/**
 * The layout lookup failed, so nothing was written - the check runs before the
 * session insert, and a track row this save created is rolled back. Unlike the
 * message below, "not saved" is therefore certain here.
 */
const SESSION_LAYOUT_LOOKUP_FAILED_MESSAGE =
  'Your session was not saved - we could not check the layout you picked, and the fault is ours, not what you entered. Everything you typed is still on this page, so try saving again in a few minutes.';

/**
 * The same fault on the CREATE path, which has to stop short of what this code
 * can actually promise.
 *
 * `create_session_with_laps` writes the session, its laps and its environment in
 * one transaction, so a database that answered with an error stored none of it.
 * A transport failure is different: the call may have committed and only the
 * answer been lost, and the server action mints a new id for the next save, so
 * a rider told "nothing was stored" who re-enters the session could end up with
 * two. So it names what is certain (the fault is ours) and sends them to look
 * before re-entering rather than promising a clean slate.
 */
const SESSION_CREATE_SAVE_FAILED_MESSAGE =
  'Your session may not have saved - something is wrong on our end, not with what you entered. Check your sessions list before you enter it again, in case it saved after all. What you typed is still on this page, so copy anything you need before you leave.';

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
  supabase: SessionWriteClient,
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

/** Which track row a session belongs to, and the name stored alongside it. */
interface ResolvedSessionTrack {
  trackId: string | null;
  trackName: string | null;
  /**
   * Which configuration of that circuit, resolved rather than trusted, and null
   * whenever the rider did not choose one - which is most of the time and is the
   * point. `layoutName` is denormalised beside it for the same reason
   * `trackName` is: `sessions.layout_id` is `on delete set null`.
   */
  layoutId: string | null;
  layoutName: string | null;
  /** A new `tracks` row was written, so the tracks list changed. */
  createdTrack: boolean;
  /**
   * The rider chose a layout and the read that checks it failed. The save has to
   * stop: an unanswered lookup is not "no such layout", and saving with a null
   * layout would discard a choice the rider made because of our fault.
   */
  layoutLookupFailed: boolean;
}

/**
 * The layout a session ran, or null.
 *
 * A layout id is checked against the track it was submitted with rather than
 * read on its own, because a layout belongs to exactly one circuit: an id from
 * a different one is not a narrower answer, it is a session claiming a
 * configuration its track does not have. A layout that does not check out is
 * dropped and the session still saves - the layout is optional, so there is
 * nothing here worth refusing a rider's session over. The row's own name wins
 * over anything submitted, exactly as `resolveSessionTrack` treats a track name.
 *
 * A FAILED read is different from a layout that does not check out: it answers
 * nothing, so it is reported and flagged for `createSessionForUser` to refuse the save
 * rather than silently storing the session without the layout the rider chose.
 */
async function resolveSessionLayout(
  supabase: SessionWriteClient,
  report: ReportError,
  trackId: string | null,
  layoutId: string | null | undefined,
): Promise<Pick<ResolvedSessionTrack, 'layoutId' | 'layoutName' | 'layoutLookupFailed'>> {
  const none = { layoutId: null, layoutName: null, layoutLookupFailed: false };
  if (!layoutId || !trackId) return none;

  const { data, error } = await supabase
    .from('track_layouts')
    .select('id, name')
    .eq('id', layoutId)
    .eq('track_id', trackId)
    .maybeSingle();

  if (error) {
    report('session-layout', new Error(error.message), {
      reason: error.code,
      table: 'track_layouts',
      trackId,
      layoutId,
    });
    return { ...none, layoutLookupFailed: true };
  }

  const row = data as { id: string; name: string } | null;
  if (!row) return none;

  return { layoutId: row.id, layoutName: row.name, layoutLookupFailed: false };
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
  supabase: SessionWriteClient,
  report: ReportError,
  userId: string,
  hasProAccess: boolean,
  trackId: string | null,
  trackName: string | null,
  layoutId: string | null | undefined,
): Promise<ResolvedSessionTrack> {
  const typed = normalizeTrackName(trackName);
  // The layout is resolved against whichever circuit resolution settles on, so
  // every exit below routes through this rather than returning a bare object.
  const withLayout = async (track: Omit<ResolvedSessionTrack, 'layoutId' | 'layoutName' | 'layoutLookupFailed'>) => ({
    ...track,
    ...(await resolveSessionLayout(supabase, report, track.trackId, layoutId)),
  });

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
      return withLayout({ trackId, trackName: typed, createdTrack: false });
    }

    const resolvedName = normalizeTrackName((data as { name?: string } | null)?.name);
    if (data && resolvedName) return withLayout({ trackId, trackName: resolvedName, createdTrack: false });
    // Unreachable or unknown id: fall through and resolve the typed name instead
    // of saving a link the rider cannot follow.
  }

  if (!typed) {
    return {
      trackId: null,
      trackName: null,
      layoutId: null,
      layoutName: null,
      createdTrack: false,
      layoutLookupFailed: false,
    };
  }

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
    return withLayout({ trackId: null, trackName: typed, createdTrack: false });
  }

  if (lookup.status === 'found') {
    return withLayout({ trackId: lookup.track.id, trackName: lookup.track.name, createdTrack: false });
  }

  if (!hasProAccess) {
    const { count } = await supabase
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', userId)
      .eq('is_seeded', false);

    if ((count ?? 0) >= getFreePlanLimit('tracks')) {
      return withLayout({ trackId: null, trackName: typed, createdTrack: false });
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
    return withLayout({ trackId: null, trackName: typed, createdTrack: false });
  }

  // A track this call just created has no layouts, so nothing submitted can
  // resolve against it - `withLayout` says so rather than this comment assuming it.
  return withLayout({ trackId: created.id, trackName: created.name, createdTrack: true });
}

const UNIQUE_VIOLATION_CODE = '23505';
const FOREIGN_KEY_VIOLATION_CODE = '23503';
/**
 * `create_session_with_laps` refusing a vehicle that is not the rider's - one
 * deleted since the session was logged, or another rider's. Neither is fixed by
 * a retry, so it is the rider's to resolve like the foreign key it stands in for.
 */
const VEHICLE_NOT_OWNED_CODE = 'TT404';
/**
 * `create_session_with_laps` refusing a free rider's session past the plan's
 * cap. It counts under a per-rider lock (20260928002300), so two saves at the
 * last free slot cannot both pass - the reason the count moved there.
 */
const PLAN_LIMIT_CODE = 'TT402';

/**
 * What this rider already has under a session id: the session, or the record
 * that they deleted it (`deleted_sessions`, 20260928002300), read through their
 * own client so RLS decides what "theirs" means. A failed read is not "no such
 * session": treating it as one would go on to insert, and the insert would then
 * fail on the key the read could not see.
 */
async function readOwnSession(
  supabase: SessionWriteClient,
  report: ReportError,
  userId: string,
  sessionId: string,
): Promise<{ status: 'found'; session: Session } | { status: 'deleted' } | { status: 'absent' } | { status: 'failed' }> {
  const { data, error } = await supabase
    .from('sessions')
    .select()
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    report('session-create', new Error(error.message), {
      reason: error.code,
      table: 'sessions',
      query: 'replay lookup',
      userId,
      sessionId,
    });
    return { status: 'failed' };
  }
  if (data) return { status: 'found', session: readStoredSession(data) };

  const { data: tombstone, error: tombstoneError } = await supabase
    .from('deleted_sessions')
    .select('session_id')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (tombstoneError) {
    report('session-create', new Error(tombstoneError.message), {
      reason: tombstoneError.code,
      table: 'deleted_sessions',
      query: 'replay lookup',
      userId,
      sessionId,
    });
    return { status: 'failed' };
  }

  return tombstone ? { status: 'deleted' } : { status: 'absent' };
}

/**
 * The environment's own columns, or null when the rider gave none - the one
 * rule for which environment a create writes, whichever way it writes it.
 */
function environmentValues(
  environment: CreateSessionEnvironmentInput | null | undefined,
): Omit<TableInsert<'session_environment'>, 'user_id' | 'session_id'> | null {
  if (!hasEnvironmentValues(environment)) return null;
  return {
    ambient_temperature_c: environment?.ambient_temperature_c ?? null,
    track_temperature_c: environment?.track_temperature_c ?? null,
    humidity_percent: environment?.humidity_percent ?? null,
    weather_condition: environment?.weather_condition?.trim() || null,
    surface_condition: environment?.surface_condition?.trim() || null,
    source: environment?.source ?? 'manual',
  };
}

type SessionWrite =
  | { status: 'created'; session: Session }
  | { status: 'answered'; result: CreateSessionResult };

interface SessionWriteParams {
  supabase: SessionWriteClient;
  report: ReportError;
  userId: string;
  sessionId: string;
  payload: TableInsert<'sessions'>;
  input: CreateSessionInput;
  track: ResolvedSessionTrack;
}

/**
 * The write: the row, its laps and its environment in one call to
 * `create_session_with_laps` (20260927002200), so a failure leaves nothing
 * behind and a retry on the same id either writes all of it or finds all of it.
 * A stored session is therefore always complete, and a replay writes nothing -
 * least of all over laps the rider has since edited on the website.
 */
async function insertSession({
  supabase,
  report,
  userId,
  sessionId,
  payload,
  input,
  track,
}: SessionWriteParams): Promise<SessionWrite> {
  const { data, error } = await supabase.rpc('create_session_with_laps', {
    p_session_id: sessionId,
    p_session: payload as unknown as Json,
    p_laps: (input.laps ?? []) as unknown as Json,
    p_environment: environmentValues(input.environment) as Json | null,
  });

  if (error) {
    // A database that answered with a code rolled the whole call back, so the
    // track it was resolved for is unused. A transport failure carries no code
    // and may have committed, and a track taken out from under a stored session
    // strips its circuit (`sessions.track_id` is `on delete set null`), so that
    // one stays.
    if (error.code) await rollbackAutoCreatedTrack(supabase, userId, track);
    // The id is held by a row this rider cannot see: another rider's.
    if (error.code === UNIQUE_VIOLATION_CODE) {
      return { status: 'answered', result: { ok: false, error: SESSION_ID_TAKEN_MESSAGE, kind: 'id_taken' } };
    }
    if (error.code === VEHICLE_NOT_OWNED_CODE) {
      return { status: 'answered', result: { ok: false, error: SESSION_VEHICLE_NOT_OWNED_MESSAGE, kind: 'invalid' } };
    }
    if (error.code === FOREIGN_KEY_VIOLATION_CODE) {
      return { status: 'answered', result: { ok: false, error: SESSION_REFERENCE_GONE_MESSAGE, kind: 'invalid' } };
    }
    if (error.code === PLAN_LIMIT_CODE) {
      return { status: 'answered', result: { ok: false, error: getFreePlanLimitMessage('sessions'), kind: 'plan_limit' } };
    }
    report('session-create', new Error(error.message), {
      reason: error.code,
      query: 'create_session_with_laps',
      details: error.details,
      hint: error.hint,
      userId,
      sessionId,
    });
    return { status: 'answered', result: { ok: false, error: SESSION_CREATE_SAVE_FAILED_MESSAGE, kind: 'fault' } };
  }

  const answer = data as unknown as
    | { replayed: false; session: unknown }
    | { replayed: true; deleted?: false; session: unknown }
    | { replayed: true; deleted: true; session: null };
  if (!answer.replayed) return { status: 'created', session: readStoredSession(answer.session) };

  // The rider deleted this session after an earlier call stored it. Nothing
  // was written, so a track resolved for this call is unused.
  if (answer.deleted) {
    await rollbackAutoCreatedTrack(supabase, userId, track);
    return {
      status: 'answered',
      result: { ok: true, data: { session: null, createdTrack: false, replayed: true, deleted: true } },
    };
  }

  // A call on the same id committed while this one was resolving, and its row
  // is the answer. It may have found this call's auto-created track by name, so
  // the track goes only when that row does not point at it.
  const session = readStoredSession(answer.session);
  if (session.track_id !== track.trackId) await rollbackAutoCreatedTrack(supabase, userId, track);
  return { status: 'answered', result: { ok: true, data: { session, createdTrack: false, replayed: true, deleted: false } } };
}

/**
 * Create a session for `userId` through `supabase`, which must already be acting
 * as that rider - every write here relies on RLS agreeing with `userId`.
 *
 * Revalidation is the caller's: only a Next server action has a cache to
 * invalidate, which is why `createdTrack` travels back with the row.
 */
export async function createSessionForUser(
  { supabase, userId, resolveProAccess, report }: CreateSessionContext,
  input: CreateSessionInput,
  { id: sessionId }: CreateSessionOptions,
): Promise<CreateSessionResult> {
  // A replay is answered before anything else, so it costs no track resolution
  // and is not judged against what the rider has changed since the first call.
  // `create_session_with_laps` asks both questions again under its lock.
  const existing = await readOwnSession(supabase, report, userId, sessionId);
  if (existing.status === 'failed') return { ok: false, error: SESSION_CREATE_SAVE_FAILED_MESSAGE, kind: 'fault' };
  if (existing.status === 'found') {
    return { ok: true, data: { session: existing.session, createdTrack: false, replayed: true, deleted: false } };
  }
  if (existing.status === 'deleted') {
    return { ok: true, data: { session: null, createdTrack: false, replayed: true, deleted: true } };
  }

  const lapValidationError = validateLaps(input.laps ?? []);
  if (lapValidationError) return { ok: false, error: lapValidationError, kind: 'invalid' };

  // The same rule the form checks. `sessions.conditions` is NOT NULL, so a
  // session with no weather answer has to be refused here rather than saved
  // with whatever the form happened to open with. See lib/session-answers.ts.
  if (!isSessionCondition(input.conditions)) return { ok: false, error: MISSING_CONDITIONS_MESSAGE, kind: 'invalid' };

  // Track is checked here as well as on the form, and checked on the payload
  // rather than after resolution, so a refusal happens before anything is
  // written: `resolveSessionTrack` inserts a track row, and refusing after it
  // would spend one of a free rider's three custom-track slots on a session that
  // was never saved. A payload naming neither an id nor a name cannot resolve to
  // a circuit, so nothing later can rescue it. See lib/session-track.ts.
  if (!input.track_id && !hasTrackName(input.track_name)) {
    return { ok: false, error: MISSING_TRACK_MESSAGE, kind: 'invalid' };
  }

  // Pro access lifts the custom-track cap below. The session cap is counted
  // inside `create_session_with_laps`, which reads the entitlement itself.
  const hasProAccess = await resolveProAccess();

  const track = await resolveSessionTrack(
    supabase,
    report,
    userId,
    hasProAccess,
    input.track_id,
    input.track_name,
    input.layout_id,
  );

  // A `track_id` the rider cannot see resolves to nothing, and with no typed name
  // beside it the session would still store no circuit. Rolling the auto-created
  // row back is unnecessary here - a resolution that created one always carries
  // its name - but it is called anyway so this guard cannot start leaking rows if
  // resolution changes.
  if (!track.trackName) {
    await rollbackAutoCreatedTrack(supabase, userId, track);
    return { ok: false, error: MISSING_TRACK_MESSAGE, kind: 'invalid' };
  }

  if (track.layoutLookupFailed) {
    await rollbackAutoCreatedTrack(supabase, userId, track);
    return { ok: false, error: SESSION_LAYOUT_LOOKUP_FAILED_MESSAGE, kind: 'fault' };
  }

  const payload: TableInsert<'sessions'> = {
    user_id: userId,
    vehicle_id: input.vehicle_id,
    track_id: track.trackId,
    track_name: track.trackName,
    ...(track.layoutId
      ? { layout_id: track.layoutId, layout_name: track.layoutName }
      : {}),
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

  const written = await insertSession({ supabase, report, userId, sessionId, payload, input, track });
  if (written.status === 'answered') return written.result;
  const createdSession = written.session;

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
        .eq('user_id', userId)
        .single(),
      fetchPreviousSession(supabase, userId, createdSession),
      supabase
        .from('vehicle_baselines')
        .select('*')
        .eq('user_id', userId)
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
        userId,
        sessionId: createdSession.id,
        vehicleId: createdSession.vehicle_id,
      });
    } else {
      const baseline = ((baselineRows ?? [])[0] ?? null) as VehicleBaseline | null;

      const changeRows: TableInsert<'session_changes'>[] = [];

      if (previousSession) {
        changeRows.push({
          user_id: userId,
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
          user_id: userId,
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
            userId,
            sessionId: createdSession.id,
            error: changesError.message,
          });
        }
      }
    }
  } catch (changeTrackingError) {
    console.error('[sessions] session_changes computation failed', {
      userId,
      sessionId: createdSession.id,
      error:
        changeTrackingError instanceof Error ? changeTrackingError.message : String(changeTrackingError),
    });
  }

  return { ok: true, data: { session: createdSession, createdTrack: track.createdTrack, replayed: false, deleted: false } };
}
