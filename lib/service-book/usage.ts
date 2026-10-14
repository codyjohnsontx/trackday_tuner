import type { Tables } from '@/types/supabase';
import { instantOf } from '@/lib/service-book/calendar';

/**
 * How much a bike has been used: hour-meter and odometer.
 *
 * READINGS ARE THE TRUTH (owner, Q2). The rider's own reading - typed, or the
 * one an entry carried, which the database copies into `vehicle_readings` - is
 * what the bike has done. Logged track sessions only estimate the gap since the
 * latest reading, and are labelled an estimate wherever they are shown. The
 * estimate is derived on every read and never stored, so a corrected weight or a
 * new reading moves it with no backfill.
 *
 * THE RIDER DECIDES WHAT A DAY COUNTS FOR (owner, 2026-10-08: "doing a day at a
 * smaller track won't warrant an oil change but a big day somewhere like cota
 * would"). A `session_usage_weights` row scales a session - 0 is "this day does
 * not count", 2 a big day - and its minutes or distance override replaces the
 * estimate for that session outright.
 *
 * A session's time on track is its own lap times when it has any, because that is
 * how long the rider was actually out; a session with none falls back to the
 * book's `default_session_minutes`. There is no track length anywhere in the
 * schema, so distance is only ever the rider's override or the book's default per
 * session, and a session with neither adds no distance and is counted as missing
 * one rather than as zero.
 *
 * Pure: no Supabase, no Next, so the phone app can import it.
 */

export type UsageAxis = 'hours' | 'distance';

export type UsageBook = Pick<
  Tables<'service_books'>,
  'tracks_hours' | 'tracks_distance' | 'default_session_minutes' | 'default_session_distance'
>;
export type UsageReading = Pick<
  Tables<'vehicle_readings'>,
  'id' | 'reading_date' | 'read_at' | 'hours' | 'distance' | 'supersedes_id'
>;
/** A session of the book's own vehicle. */
export type UsageSession = Pick<Tables<'sessions'>, 'id' | 'date' | 'created_at'>;
export type UsageLap = Pick<Tables<'session_laps'>, 'session_id' | 'lap_time_ms' | 'included'>;
export type UsageWeight = Pick<
  Tables<'session_usage_weights'>,
  'session_id' | 'weight' | 'minutes_override' | 'distance_override'
>;

export interface UsageInput {
  book: UsageBook;
  readings: readonly UsageReading[];
  sessions: readonly UsageSession[];
  laps: readonly UsageLap[];
  weights: readonly UsageWeight[];
}

/** What one session adds, before and after the rider's weight. */
export interface SessionUsage {
  sessionId: string;
  date: string;
  /** The rider's weight, 1 when they set none. */
  weight: number;
  minutesBasis: 'override' | 'laps' | 'default';
  /** Time on track before the weight. */
  minutes: number;
  /** Weighted hours this session adds. */
  hours: number;
  distanceBasis: 'override' | 'default' | null;
  /** Weighted distance this session adds; `null` when the session has none to give. */
  distance: number | null;
}

/**
 * - `reading`: the latest reading, and nothing logged since adds to it.
 * - `reading_plus_estimate`: the latest reading plus sessions since.
 * - `estimate_only`: no reading at all; usage counted from zero at the first session.
 * - `none`: no reading and no session that could give a figure, so there is
 *   nothing to say.
 */
export type UsageBasis = 'reading' | 'reading_plus_estimate' | 'estimate_only' | 'none';

export interface AxisUsage {
  axis: UsageAxis;
  /** The reading the figure starts from. */
  reading: { id: string; value: number; date: string } | null;
  /** The sessions counted on top of the reading, oldest first, weight 0 included. */
  sessions: SessionUsage[];
  /** What those sessions add; 0 when none do. */
  estimate: number;
  /** Reading plus estimate; `null` when the basis is `none`. */
  current: number | null;
  basis: UsageBasis;
  /** Counted sessions (weight above 0) that had no distance to give. Always 0 for hours. */
  sessionsWithoutDistance: number;
}

export interface BookUsage {
  /** `null` when the book does not track that axis. */
  hours: AxisUsage | null;
  distance: AxisUsage | null;
}

export interface UsageOptions {
  /**
   * Usage as it stood on this date (`YYYY-MM-DD`) rather than now: readings on or
   * before it, sessions strictly before it. A session on the day itself is left
   * out because nothing says whether it ran before or after the work, and leaving
   * it out makes the next service due sooner rather than later.
   */
  asOf?: string;
}

const MAX_WEIGHT = 3;

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function weightOf(row: UsageWeight | undefined): number {
  const weight = finite(row?.weight);
  if (weight === null) return 1;
  return Math.min(Math.max(weight, 0), MAX_WEIGHT);
}

/** Minutes on track from a session's included laps, or `null` when it has none to sum. */
export function lapMinutes(laps: readonly UsageLap[]): number | null {
  let ms = 0;
  for (const lap of laps) {
    const time = finite(lap.lap_time_ms);
    if (lap.included && time !== null && time > 0) ms += time;
  }
  return ms > 0 ? ms / 60_000 : null;
}

export function estimateSessionUsage(
  book: UsageBook,
  session: UsageSession,
  laps: readonly UsageLap[],
  weightRow?: UsageWeight,
): SessionUsage {
  const weight = weightOf(weightRow);

  let minutesBasis: SessionUsage['minutesBasis'];
  let minutes: number;
  const minutesOverride = finite(weightRow?.minutes_override);
  const fromLaps = lapMinutes(laps);
  if (minutesOverride !== null && minutesOverride >= 0) {
    minutesBasis = 'override';
    minutes = minutesOverride;
  } else if (fromLaps !== null) {
    minutesBasis = 'laps';
    minutes = fromLaps;
  } else {
    minutesBasis = 'default';
    minutes = Math.max(finite(book.default_session_minutes) ?? 0, 0);
  }

  let distanceBasis: SessionUsage['distanceBasis'] = null;
  let rawDistance: number | null = null;
  const distanceOverride = finite(weightRow?.distance_override);
  const defaultDistance = finite(book.default_session_distance);
  if (distanceOverride !== null && distanceOverride >= 0) {
    distanceBasis = 'override';
    rawDistance = distanceOverride;
  } else if (defaultDistance !== null && defaultDistance >= 0) {
    distanceBasis = 'default';
    rawDistance = defaultDistance;
  }

  return {
    sessionId: session.id,
    date: session.date,
    weight,
    minutesBasis,
    minutes,
    hours: (weight * minutes) / 60,
    distanceBasis,
    distance: rawDistance === null ? null : weight * rawDistance,
  };
}

/** Readings no later reading corrects: the rider's word as it stands. */
export function currentReadings(readings: readonly UsageReading[]): UsageReading[] {
  const superseded = new Set(readings.map((reading) => reading.supersedes_id).filter(Boolean));
  return readings.filter((reading) => !superseded.has(reading.id));
}

/** Newest first: by reading date, then by when it was recorded. */
function compareReadingsDesc(a: UsageReading, b: UsageReading): number {
  if (a.reading_date !== b.reading_date) return a.reading_date < b.reading_date ? 1 : -1;
  const at = (instantOf(b.read_at) ?? 0) - (instantOf(a.read_at) ?? 0);
  if (at !== 0) return at;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function axisValue(reading: UsageReading, axis: UsageAxis): number | null {
  const value = finite(axis === 'hours' ? reading.hours : reading.distance);
  return value !== null && value >= 0 ? value : null;
}

/** The latest reading carrying a value on this axis, as of `asOf` when given. */
export function latestReading(
  readings: readonly UsageReading[],
  axis: UsageAxis,
  asOf?: string,
): UsageReading | null {
  const candidates = currentReadings(readings)
    .filter((reading) => axisValue(reading, axis) !== null)
    .filter((reading) => asOf === undefined || reading.reading_date <= asOf)
    .sort(compareReadingsDesc);
  return candidates[0] ?? null;
}

/** The earliest reading carrying a value on this axis. */
export function firstReading(readings: readonly UsageReading[], axis: UsageAxis): UsageReading | null {
  const candidates = currentReadings(readings)
    .filter((reading) => axisValue(reading, axis) !== null)
    .sort(compareReadingsDesc);
  return candidates[candidates.length - 1] ?? null;
}

/**
 * Whether a session ran after a reading: a later date, or the same date and
 * logged after the reading was. A reading taken in the paddock at lunch counts
 * the afternoon session the rider logged after it, and not the morning one.
 */
function isAfterReading(session: UsageSession, reading: UsageReading): boolean {
  if (session.date !== reading.reading_date) return session.date > reading.reading_date;
  const sessionAt = instantOf(session.created_at);
  const readAt = instantOf(reading.read_at);
  return sessionAt !== null && readAt !== null && sessionAt > readAt;
}

/** Oldest first: by date, then by when it was logged. */
export function compareSessionsAsc(a: UsageSession, b: UsageSession): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (instantOf(a.created_at) ?? 0) - (instantOf(b.created_at) ?? 0);
}

/** What each session `include` keeps adds, oldest first. */
function sessionUsages(input: UsageInput, include: (session: UsageSession) => boolean): SessionUsage[] {
  const lapsBySession = new Map<string, UsageLap[]>();
  for (const lap of input.laps) {
    const list = lapsBySession.get(lap.session_id) ?? [];
    list.push(lap);
    lapsBySession.set(lap.session_id, list);
  }
  const weightBySession = new Map(input.weights.map((row) => [row.session_id, row]));

  return input.sessions
    .filter(include)
    .sort(compareSessionsAsc)
    .map((session) =>
      estimateSessionUsage(input.book, session, lapsBySession.get(session.id) ?? [], weightBySession.get(session.id)),
    );
}

/**
 * Usage on `date` worked back from a later `reading`: the reading less what the
 * sessions from that date until the reading add, never below zero. A session on
 * the day itself is taken off too, so the figure errs low and whatever is counted
 * from it comes due sooner rather than later.
 */
export function usageBeforeReading(
  input: UsageInput,
  axis: UsageAxis,
  date: string,
  reading: UsageReading,
): number | null {
  const value = axisValue(reading, axis);
  if (value === null) return null;
  let estimate = 0;
  for (const session of sessionUsages(input, (s) => s.date >= date && !isAfterReading(s, reading))) {
    estimate += (axis === 'hours' ? session.hours : session.distance) ?? 0;
  }
  return Math.max(value - estimate, 0);
}

function axisUsage(input: UsageInput, axis: UsageAxis, asOf: string | undefined): AxisUsage {
  const reading = latestReading(input.readings, axis, asOf);
  const sessions = sessionUsages(
    input,
    (session) => (asOf === undefined || session.date < asOf) && (reading === null || isAfterReading(session, reading)),
  );

  let estimate = 0;
  let measured = 0;
  let sessionsWithoutDistance = 0;
  for (const session of sessions) {
    if (axis === 'hours') {
      estimate += session.hours;
      measured += 1;
    } else if (session.distance === null) {
      if (session.weight > 0) sessionsWithoutDistance += 1;
    } else {
      estimate += session.distance;
      measured += 1;
    }
  }

  const readingValue = reading ? (axisValue(reading, axis) as number) : null;
  let basis: UsageBasis;
  let current: number | null;
  if (readingValue !== null) {
    basis = estimate > 0 ? 'reading_plus_estimate' : 'reading';
    current = readingValue + estimate;
  } else if (measured > 0) {
    // With no reading, sessions that could not say a distance are not a zero.
    basis = 'estimate_only';
    current = estimate;
  } else {
    basis = 'none';
    current = null;
  }

  return {
    axis,
    reading: reading && readingValue !== null ? { id: reading.id, value: readingValue, date: reading.reading_date } : null,
    sessions,
    estimate,
    current,
    basis,
    sessionsWithoutDistance,
  };
}

/** The bike's usage on each axis the book tracks. */
export function computeUsage(input: UsageInput, options: UsageOptions = {}): BookUsage {
  return {
    hours: input.book.tracks_hours ? axisUsage(input, 'hours', options.asOf) : null,
    distance: input.book.tracks_distance ? axisUsage(input, 'distance', options.asOf) : null,
  };
}
