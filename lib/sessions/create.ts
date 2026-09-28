import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchPreviousSession } from '@/lib/session-previous';
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
  CreateSessionLapInput,
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
 * session arrives. The free-plan session cap is the exception: a create carrying
 * its own id is counted inside `create_session_with_laps` (20260928002300).
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
 * nothing is written again and there is no row to answer with. Only a caller
 * supplying an id can see it.
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
   * twice. It travels here rather than inside `CreateSessionInput` so the
   * website's server action, whose input is whatever a browser posted, cannot
   * choose a row's primary key.
   */
  id?: string;
}

/**
 * The supplied id belongs to a row this rider cannot see. With v4 ids that is
 * practically never a collision, so it is a client that reused an id - nothing a
 * retry can fix, and nothing to tell the rider beyond that it did not save.
 */
export const SESSION_ID_TAKEN_MESSAGE =
  'This session could not be saved because its id is already in use. Log it again as a new session.';

/**
 * The insert named a row that is gone - in practice a vehicle deleted on the
 * website while this session waited on the phone. No retry brings it back.
 */
export const SESSION_REFERENCE_GONE_MESSAGE =
  'This session could not be saved because the vehicle or track it was logged against no longer exists. Choose them again and save it.';

/**
 * The website form named a vehicle that is not one of this rider's - deleted in
 * another tab, or a request that was never the form's. `sessions: insert own`
 * refuses it (20260928002300); this is the sentence the rider reads instead of
 * that policy's error.
 */
export const SESSION_VEHICLE_NOT_OWNED_MESSAGE =
  'This session was not saved because the vehicle it names is not in your garage. Choose one of your vehicles and save it again.';

/** The vehicle check could not answer, so nothing was written. */
const SESSION_VEHICLE_LOOKUP_FAILED_MESSAGE =
  'Your session was not saved - we could not check the vehicle you picked, and the fault is ours, not what you entered. Everything you typed is still on this page, so try saving again in a few minutes.';

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
 * its own above. Any OTHER code answers with the CALLER's `saveFailedMessage`
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

/**
 * The same fault on the CREATE path, where the sentence has to name more - and
 * has to stop short of what this code can actually promise.
 *
 * `createSessionForUser` inserts the session row first, so a later failure runs
 * `rollbackCreatedSession` to take it back out. A rider told only that their LAP
 * TIMES were not saved would copy the laps, leave, and find no session at all,
 * which is why this sentence is session-level. But it must not say the session
 * was removed either: that delete reports nothing back and gives up quietly when
 * it errors or matches no rows - and the two faults correlate, because a dead
 * transport fails the write AND the delete that follows it. A rider told
 * "nothing was stored" who then re-enters the session ends up with two.
 *
 * So it names what is certain (the save did not finish, and the fault is ours),
 * and sends them to look before re-entering rather than promising a clean slate.
 */
/**
 * The layout lookup failed, so nothing was written - the check runs before the
 * session insert, and a track row this save created is rolled back. Unlike the
 * message below, "not saved" is therefore certain here.
 */
const SESSION_LAYOUT_LOOKUP_FAILED_MESSAGE =
  'Your session was not saved - we could not check the layout you picked, and the fault is ours, not what you entered. Everything you typed is still on this page, so try saving again in a few minutes.';

const SESSION_CREATE_SAVE_FAILED_MESSAGE =
  'Your session did not save completely - something is wrong on our end, not with what you entered. Check your sessions list before you enter it again, in case a partial one was left behind. What you typed is still on this page, so copy anything you need before you leave.';

export async function persistSessionLaps(params: {
  supabase: SessionWriteClient;
  report: ReportError;
  userId: string;
  session: Session;
  laps: CreateSessionLapInput[];
  /**
   * The laps the caller read before deciding on this replacement, echoed back
   * for the RPC to check against what is stored. It refuses the delete when the
   * two differ, so neither a caller that mistook a failed read for an empty
   * session nor a second tab holding an equal-count snapshot can replace laps it
   * never saw. The rows travel rather than a digest of them: folding an identity
   * here as well as in SQL would be two records of one fact, and they drift.
   */
  expectedLaps: CreateSessionLapInput[];
  /**
   * What a rider reads when the fault is ours rather than theirs. It belongs to
   * the CALLER because the two callers lose different things: `replaceSessionLaps`
   * loses the lap times, `createSessionForUser` rolls the whole session back.
   */
  saveFailedMessage: string;
}): Promise<string | null> {
  const validationError = validateLaps(params.laps);
  if (validationError) return validationError;
  const { error } = await params.supabase.rpc('replace_session_laps', {
    p_user_id: params.userId,
    p_session_id: params.session.id,
    p_laps: params.laps as unknown as Json,
    p_expected_laps: params.expectedLaps as unknown as Json,
  });
  if (!error) return null;
  if (error.code === SESSION_LAPS_STALE_READ_CODE) return SESSION_LAPS_STALE_READ_MESSAGE;
  if (error.code === SESSION_LAPS_DOMAIN_REJECTION_CODE) return error.message;
  params.report('session-laps', new Error(error.message), {
    reason: error.code,
    query: 'replace_session_laps',
    details: error.details,
    hint: error.hint,
  });
  return params.saveFailedMessage;
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
  supabase: SessionWriteClient;
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
const INVALID_TEXT_REPRESENTATION_CODE = '22P02';
const INSUFFICIENT_PRIVILEGE_CODE = '42501';

/**
 * Whether `vehicleId` is one of this rider's vehicles, read through their own
 * client. A failed read is not "not yours": refusing on it would tell a rider
 * their own bike is missing.
 */
async function readVehicleOwnership(
  supabase: SessionWriteClient,
  report: ReportError,
  userId: string,
  vehicleId: string,
): Promise<'owned' | 'not_owned' | 'failed'> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id')
    .eq('id', vehicleId)
    .eq('user_id', userId)
    .maybeSingle();

  // A value that is not a uuid names no vehicle at all.
  if (error?.code === INVALID_TEXT_REPRESENTATION_CODE) return 'not_owned';
  if (error) {
    report('session-create', new Error(error.message), {
      reason: error.code,
      table: 'vehicles',
      query: 'vehicle ownership',
      userId,
    });
    return 'failed';
  }
  return data ? 'owned' : 'not_owned';
}

/**
 * One of this rider's sessions by id, read through their own client so RLS
 * decides what "theirs" means. A failed read is not "no such session": treating
 * it as one would go on to insert, and the insert would then fail on the key
 * the read could not see.
 */
async function readOwnSession(
  supabase: SessionWriteClient,
  report: ReportError,
  userId: string,
  sessionId: string,
): Promise<{ status: 'found'; session: Session } | { status: 'absent' } | { status: 'failed' }> {
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

  return data ? { status: 'found', session: data as Session } : { status: 'absent' };
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
  payload: TableInsert<'sessions'>;
  input: CreateSessionInput;
  track: ResolvedSessionTrack;
}

/**
 * The website's write: the row, then its laps, then its environment, deleting
 * the row again when a later step fails. The form stays open on a failure, so
 * a rollback that failed too is something the rider is told to check for.
 */
async function insertSessionInSteps({
  supabase,
  report,
  userId,
  payload,
  input,
  track,
}: SessionWriteParams): Promise<SessionWrite> {
  const { data, error } = await supabase
    .from('sessions')
    .insert(payload)
    .select()
    .single();

  if (error) {
    // `sessions: insert own` refuses a vehicle that is not the rider's
    // (20260928002300) - one deleted in another tab, or a request that was never
    // the form's - and RLS answers that as `42501`. The policy is the rule; this
    // only chooses the sentence, so it asks which vehicle it was after the
    // insert refused rather than before, and a missing grant, which is also
    // `42501`, still reads as the fault it is.
    if (error.code === INSUFFICIENT_PRIVILEGE_CODE) {
      const ownership = await readVehicleOwnership(supabase, report, userId, payload.vehicle_id);
      if (ownership !== 'owned') {
        await rollbackAutoCreatedTrack(supabase, userId, track);
        return {
          status: 'answered',
          result:
            ownership === 'not_owned'
              ? { ok: false, error: SESSION_VEHICLE_NOT_OWNED_MESSAGE, kind: 'invalid' }
              : { ok: false, error: SESSION_VEHICLE_LOOKUP_FAILED_MESSAGE, kind: 'fault' },
        };
      }
    }
    // A plain insert, so as with the environment path below there is no `P0001`
    // class to let through: nothing PostgREST answers here is a rider's to fix.
    // `enabled_modules` and `extra_modules` arrive with 20260228000200, so a
    // database behind that migration answered `PGRST204 Could not find the
    // 'enabled_modules' column of 'sessions' in the schema cache` straight into
    // the form's sticky bar, with nothing reaching Sentry.
    report('session-create', new Error(error.message), {
      reason: error.code,
      table: 'sessions',
      details: error.details,
      hint: error.hint,
      userId,
    });
    await rollbackAutoCreatedTrack(supabase, userId, track);
    return { status: 'answered', result: { ok: false, error: SESSION_CREATE_SAVE_FAILED_MESSAGE, kind: 'fault' } };
  }

  const createdSession = data as Session;

  const lapError = await persistSessionLaps({
    supabase,
    report,
    userId,
    session: createdSession,
    laps: input.laps ?? [],
    // The session row was inserted two statements ago, so nothing can be holding
    // laps against it yet.
    expectedLaps: [],
    saveFailedMessage: SESSION_CREATE_SAVE_FAILED_MESSAGE,
  });
  if (lapError) {
    await rollbackCreatedSession({
      supabase,
      userId,
      sessionId: createdSession.id,
      track,
      failureLog: '[sessions] session rollback after lap failure failed',
    });
    // `persistSessionLaps` answers with the caller's own save-failed sentence
    // for a fault and with the database's for a rejection of these laps, so
    // which one came back is the classification.
    return {
      status: 'answered',
      result: { ok: false, error: lapError, kind: lapError === SESSION_CREATE_SAVE_FAILED_MESSAGE ? 'fault' : 'invalid' },
    };
  }

  const environment = environmentValues(input.environment);
  if (environment) {
    const { error: environmentError } = await supabase
      .from('session_environment')
      .insert({ user_id: userId, session_id: createdSession.id, ...environment });

    if (environmentError) {
      // A plain insert, so there is no `P0001` class to let through the way the
      // RPC paths do: nothing PostgREST answers here is a rider's to fix, and
      // `session_environment` arrives with 20260422000400, so a database behind
      // that migration used to print `PGRST205 Could not find the table ...`
      // under the form while this rider's whole session was rolled back.
      report('session-create', new Error(environmentError.message), {
        reason: environmentError.code,
        table: 'session_environment',
        details: environmentError.details,
        hint: environmentError.hint,
        userId,
        sessionId: createdSession.id,
      });
      await rollbackCreatedSession({
        supabase,
        userId,
        sessionId: createdSession.id,
        track,
        failureLog: '[sessions] session rollback failed',
      });
      return { status: 'answered', result: { ok: false, error: SESSION_CREATE_SAVE_FAILED_MESSAGE, kind: 'fault' } };
    }
  }

  return { status: 'created', session: createdSession };
}

/**
 * The phone's write: the row, its laps and its environment in one call to
 * `create_session_with_laps` (20260927002200), so a failure leaves nothing
 * behind and a retry on the same id either writes all of it or finds all of it.
 * A stored session is therefore always complete, and a replay writes nothing -
 * least of all over laps the rider has since edited on the website.
 */
async function insertSessionAtomically({
  supabase,
  report,
  userId,
  sessionId,
  payload,
  input,
  track,
}: SessionWriteParams & { sessionId: string }): Promise<SessionWrite> {
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
    // strips its circuit - see `rollbackCreatedSession` - so that one stays.
    if (error.code) await rollbackAutoCreatedTrack(supabase, userId, track);
    // The id is held by a row this rider cannot see: another rider's.
    if (error.code === UNIQUE_VIOLATION_CODE) {
      return { status: 'answered', result: { ok: false, error: SESSION_ID_TAKEN_MESSAGE, kind: 'id_taken' } };
    }
    if (error.code === FOREIGN_KEY_VIOLATION_CODE || error.code === VEHICLE_NOT_OWNED_CODE) {
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
    | { replayed: false; session: Session }
    | { replayed: true; deleted?: false; session: Session }
    | { replayed: true; deleted: true; session: null };
  if (!answer.replayed) return { status: 'created', session: answer.session };

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
  const { session } = answer;
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
  { id: suppliedId }: CreateSessionOptions = {},
): Promise<CreateSessionResult> {
  // A replay is answered before anything else, so it costs no track resolution.
  // `create_session_with_laps` asks again under its lock, and is also what
  // answers an id whose session the rider has since deleted.
  if (suppliedId) {
    const existing = await readOwnSession(supabase, report, userId, suppliedId);
    if (existing.status === 'failed') return { ok: false, error: SESSION_CREATE_SAVE_FAILED_MESSAGE, kind: 'fault' };
    if (existing.status === 'found') {
      return { ok: true, data: { session: existing.session, createdTrack: false, replayed: true, deleted: false } };
    }
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

  const hasProAccess = await resolveProAccess();
  // The phone's cap is counted inside `create_session_with_laps`, under a
  // per-rider lock, so two saves at the last free slot cannot both pass. The
  // website's form writes in separate statements with no transaction to hold
  // that lock, so it keeps this count and its fail-open read of a failed one.
  if (!hasProAccess && !suppliedId) {
    const { count } = await supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if ((count ?? 0) >= getFreePlanLimit('sessions')) {
      return {
        ok: false,
        error: getFreePlanLimitMessage('sessions'),
        kind: 'plan_limit',
      };
    }
  }

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

  const written = suppliedId
    ? await insertSessionAtomically({ supabase, report, userId, sessionId: suppliedId, payload, input, track })
    : await insertSessionInSteps({ supabase, report, userId, payload, input, track });
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
