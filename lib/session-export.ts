import { extractLapMetrics, extractLapTimes, formatLapTime } from '@/lib/session-compare';
import { resolveSessionEnabledModules } from '@/lib/session-modules';
import { trackNameKey } from '@/lib/session-track';
import type {
  Session,
  SessionEnabledModules,
  SessionEnvironment,
  TelemetrySummary,
  Vehicle,
} from '@/types';

export interface SessionExportInput {
  session: Session;
  vehicle: Vehicle | null;
  environment: SessionEnvironment | null;
  /**
   * The session's stored lap aggregates. Not optional: a caller that omits it
   * exports a session whose lap times are silently blank and reports a rider's
   * analytics with no lap data in it, which is the defect the lap columns and
   * the lap totals exist to fix.
   */
  telemetry: TelemetrySummary | null;
}

export type SessionExportRow = Record<string, string | number | boolean | null>;

export const sessionExportColumns = [
  'session_id',
  'vehicle_id',
  'vehicle_nickname',
  'vehicle_type',
  'vehicle_year',
  'vehicle_make',
  'vehicle_model',
  'track_id',
  'track_name',
  'date',
  'start_time',
  'session_number',
  'conditions',
  // Lap columns describe the *included* laps only, matching the aggregates the
  // app shows on screen. Each time is exported twice: the millisecond integer is
  // what a spreadsheet can chart, the M:SS.mmm string is what a rider can read.
  'lap_count',
  'best_lap',
  'best_lap_ms',
  'average_lap',
  'average_lap_ms',
  'consistency_spread_ms',
  'lap_times_ms',
  'ambient_temperature_c',
  'track_temperature_c',
  'humidity_percent',
  'weather_condition',
  'surface_condition',
  'environment_source',
  'tires_enabled',
  'front_tire_brand',
  'front_tire_compound',
  'front_tire_pressure',
  'rear_tire_brand',
  'rear_tire_compound',
  'rear_tire_pressure',
  'tire_condition',
  'suspension_enabled',
  'front_preload',
  'front_compression',
  'front_rebound',
  'front_suspension_direction',
  'rear_preload',
  'rear_compression',
  'rear_rebound',
  'rear_suspension_direction',
  'alignment_enabled',
  'front_camber',
  'rear_camber',
  'front_toe',
  'rear_toe',
  'caster',
  'geometry_enabled',
  'sag_front',
  'sag_rear',
  'fork_height',
  'rear_ride_height',
  'geometry_notes',
  'drivetrain_enabled',
  'front_sprocket',
  'rear_sprocket',
  'chain_length',
  'drivetrain_notes',
  'aero_enabled',
  'wing_angle',
  'splitter_setting',
  'rake',
  'aero_notes',
  'notes',
  'created_at',
] as const;

function emptyIfDisabled(enabled: boolean, value: string | number | boolean | null | undefined) {
  if (!enabled) return null;
  return value ?? null;
}

function getEnabledModules(session: Session, vehicle: Vehicle | null): SessionEnabledModules {
  return resolveSessionEnabledModules(session, vehicle?.type ?? 'motorcycle');
}

/** A lap time as `1:43.980`, or null so the CSV cell stays empty rather than reading the em dash. */
function exportLapTime(ms: number | null): string | null {
  return ms === null ? null : formatLapTime(ms);
}

/**
 * The included lap times as a single cell. Space separated rather than comma or
 * semicolon separated: both of those are field delimiters some readers sniff
 * for, and a space is never one. This is the only place the per-lap detail
 * leaves the app.
 *
 * `extractLapTimes` decides which entries are laps, because the aggregates in
 * the columns beside this one are built from the same list. Filtering it any
 * other way lets one row report `lap_count` 3 next to four printed times.
 */
function exportLapTimeList(telemetry: TelemetrySummary | null): string | null {
  const times = extractLapTimes(telemetry);
  return times.length > 0 ? times.join(' ') : null;
}

export function flattenSessionForExport({
  session,
  vehicle,
  environment,
  telemetry,
}: SessionExportInput): SessionExportRow {
  const enabled = getEnabledModules(session, vehicle);
  const geometry = session.extra_modules?.geometry;
  const drivetrain = session.extra_modules?.drivetrain;
  const aero = session.extra_modules?.aero;
  const laps = extractLapMetrics(telemetry);

  return {
    session_id: session.id,
    vehicle_id: session.vehicle_id,
    vehicle_nickname: vehicle?.nickname ?? null,
    vehicle_type: vehicle?.type ?? null,
    vehicle_year: vehicle?.year ?? null,
    vehicle_make: vehicle?.make ?? null,
    vehicle_model: vehicle?.model ?? null,
    track_id: session.track_id,
    track_name: session.track_name,
    date: session.date,
    start_time: session.start_time,
    session_number: session.session_number,
    conditions: session.conditions,
    lap_count: laps.lapCount,
    best_lap: exportLapTime(laps.bestLapMs),
    best_lap_ms: laps.bestLapMs,
    average_lap: exportLapTime(laps.averageLapMs),
    average_lap_ms: laps.averageLapMs,
    consistency_spread_ms: laps.consistencySpreadMs,
    lap_times_ms: exportLapTimeList(telemetry),
    ambient_temperature_c: environment?.ambient_temperature_c ?? null,
    track_temperature_c: environment?.track_temperature_c ?? null,
    humidity_percent: environment?.humidity_percent ?? null,
    weather_condition: environment?.weather_condition ?? null,
    surface_condition: environment?.surface_condition ?? null,
    environment_source: environment?.source ?? null,
    tires_enabled: enabled.tires,
    front_tire_brand: emptyIfDisabled(enabled.tires, session.tires.front.brand),
    front_tire_compound: emptyIfDisabled(enabled.tires, session.tires.front.compound),
    front_tire_pressure: emptyIfDisabled(enabled.tires, session.tires.front.pressure),
    rear_tire_brand: emptyIfDisabled(enabled.tires, session.tires.rear.brand),
    rear_tire_compound: emptyIfDisabled(enabled.tires, session.tires.rear.compound),
    rear_tire_pressure: emptyIfDisabled(enabled.tires, session.tires.rear.pressure),
    tire_condition: emptyIfDisabled(enabled.tires, session.tires.condition),
    suspension_enabled: enabled.suspension,
    front_preload: emptyIfDisabled(enabled.suspension, session.suspension.front.preload),
    front_compression: emptyIfDisabled(enabled.suspension, session.suspension.front.compression),
    front_rebound: emptyIfDisabled(enabled.suspension, session.suspension.front.rebound),
    front_suspension_direction: emptyIfDisabled(enabled.suspension, session.suspension.front.direction),
    rear_preload: emptyIfDisabled(enabled.suspension, session.suspension.rear.preload),
    rear_compression: emptyIfDisabled(enabled.suspension, session.suspension.rear.compression),
    rear_rebound: emptyIfDisabled(enabled.suspension, session.suspension.rear.rebound),
    rear_suspension_direction: emptyIfDisabled(enabled.suspension, session.suspension.rear.direction),
    alignment_enabled: enabled.alignment,
    front_camber: emptyIfDisabled(enabled.alignment, session.alignment?.front_camber),
    rear_camber: emptyIfDisabled(enabled.alignment, session.alignment?.rear_camber),
    front_toe: emptyIfDisabled(enabled.alignment, session.alignment?.front_toe),
    rear_toe: emptyIfDisabled(enabled.alignment, session.alignment?.rear_toe),
    caster: emptyIfDisabled(enabled.alignment, session.alignment?.caster),
    geometry_enabled: enabled.geometry,
    sag_front: emptyIfDisabled(enabled.geometry, geometry?.sag_front),
    sag_rear: emptyIfDisabled(enabled.geometry, geometry?.sag_rear),
    fork_height: emptyIfDisabled(enabled.geometry, geometry?.fork_height),
    rear_ride_height: emptyIfDisabled(enabled.geometry, geometry?.rear_ride_height),
    geometry_notes: emptyIfDisabled(enabled.geometry, geometry?.notes),
    drivetrain_enabled: enabled.drivetrain,
    front_sprocket: emptyIfDisabled(enabled.drivetrain, drivetrain?.front_sprocket),
    rear_sprocket: emptyIfDisabled(enabled.drivetrain, drivetrain?.rear_sprocket),
    chain_length: emptyIfDisabled(enabled.drivetrain, drivetrain?.chain_length),
    drivetrain_notes: emptyIfDisabled(enabled.drivetrain, drivetrain?.notes),
    aero_enabled: enabled.aero,
    wing_angle: emptyIfDisabled(enabled.aero, aero?.wing_angle),
    splitter_setting: emptyIfDisabled(enabled.aero, aero?.splitter_setting),
    rake: emptyIfDisabled(enabled.aero, aero?.rake),
    aero_notes: emptyIfDisabled(enabled.aero, aero?.notes),
    notes: session.notes,
    created_at: session.created_at,
  };
}

export function escapeCsvValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  const raw = /^[=+\-@]/.test(stringValue) ? `'${stringValue}` : stringValue;
  if (!/[",\r\n]/.test(raw)) return raw;
  return `"${raw.replaceAll('"', '""')}"`;
}

export function rowsToCsv(rows: SessionExportRow[]): string {
  const lines = [
    sessionExportColumns.join(','),
    ...rows.map((row) => sessionExportColumns.map((column) => escapeCsvValue(row[column])).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

export function buildSessionExportCsv(inputs: SessionExportInput[]): string {
  return rowsToCsv(inputs.map((input) => flattenSessionForExport(input)));
}

/**
 * A row in the coverage list - how much of each part of a session the rider
 * actually fills in. `environment` and `lap_times` are not session modules:
 * they are the same measure applied to the environment card and to lap times.
 * `environment` used to sit in the headline strip as `Env logs 2/3`, where a
 * rider reads a logging diagnostic in the slot a number about their riding
 * belongs in; `lap_times` says how many sessions carry the data the pace
 * comparison and the best-lap board are built on.
 */
export type AnalyticsCoverageKey = keyof SessionEnabledModules | 'environment' | 'lap_times';

/**
 * The fastest lap one vehicle logged at one circuit.
 *
 * A lap time only compares against another lap ridden at the same track on the
 * same vehicle - the rule `getComparableSessions` enforces, filtering on
 * `vehicle_id` before applying `sessionsMatchTrack` - so a season best is a
 * board and never a single number. Keying on the circuit alone made a bike and
 * a car at one track compete for one row, and the slower of the two had no
 * personal best anywhere on the panel.
 */
export interface AnalyticsTrackBest {
  /** `buildSessionTrackKeys` grouping key and the vehicle, so a typed name folds into the saved row and the two vehicles do not. */
  key: string;
  trackName: string;
  bestLapMs: number;
  /** Already formatted as `1:43.640`, so every surface reads the same string. */
  bestLap: string;
  sessionId: string;
  vehicleId: string;
  vehicleLabel: string;
  /** Most recent `sessions.date` this vehicle ran at this track, used to order the board. */
  lastRunDate: string;
}

export interface SessionAnalyticsSummary {
  totalSessions: number;
  /**
   * Lap totals across every session in the range. `deriveSessionAnalytics` is
   * handed each session's `telemetry` and used to throw it away, so the panel
   * named Analytics reported nothing at all about lap times - the number the
   * rider logged the session for, and the one the session rows and the compare
   * page already read off the same rows.
   */
  laps: {
    totalLaps: number;
    sessionsWithLaps: number;
  };
  /**
   * Fastest lap for each vehicle at each circuit, most recently run first, and
   * uncapped - the panel renders the whole list, so what is on screen is what
   * the rider has.
   */
  bestLapByTrack: AnalyticsTrackBest[];
  sessionsByVehicle: { vehicleId: string; label: string; count: number }[];
  topTracks: { trackName: string; count: number }[];
  moduleCoverage: { module: AnalyticsCoverageKey; count: number; percent: number }[];
  tirePressureTrends: {
    label: string;
    samples: number;
    first: string;
    latest: string;
  }[];
  environmentSnapshots: {
    withEnvironment: number;
    averageAmbientTemperatureC: number | null;
    averageTrackTemperatureC: number | null;
  };
}

/** What the board calls a circuit a session named nothing for. */
const UNNAMED_TRACK = 'Unnamed track';

/**
 * What the board calls a session carrying neither a track row nor a typed name.
 *
 * `sessionsMatchTrack` pairs such a session with nothing - not even another
 * session in the same state - so each one is its own board row. Two rows a
 * rider cannot tell apart merge those sessions again just as surely as one
 * shared key did, so the label carries what identifies the session everywhere
 * else in the app: the day it ran, and its number within that day.
 */
function unnamedTrackLabel(session: Session): string {
  const parts = [UNNAMED_TRACK, session.date];
  if (session.session_number) parts.push(`Session ${session.session_number}`);
  return parts.join(' · ');
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function parsePressure(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** `sessions.date` is an ISO calendar date, so a string comparison is the date comparison. */
function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

const MODULE_COVERAGE_ORDER = [
  'tires',
  'suspension',
  'alignment',
  'geometry',
  'drivetrain',
  'aero',
  'notes',
] as const satisfies readonly (keyof SessionEnabledModules)[];

function coverageRows(
  counts: readonly (readonly [AnalyticsCoverageKey, number])[],
  total: number,
): SessionAnalyticsSummary['moduleCoverage'] {
  return counts.map(([module, count]) => ({
    module,
    count,
    percent: total === 0 ? 0 : Math.round((count / total) * 100),
  }));
}

/** The circuit a session happened at, as a value two sessions can be keyed by. */
interface ResolvedTrack {
  key: string;
  trackName: string;
}

/**
 * Which circuit each session belongs to, keyed by session id.
 *
 * This is `sessionsMatchTrack` turned into a grouping rule: `track_id` decides
 * it whenever the session carries one, the typed `track_name` is the fallback -
 * folded through `trackNameKey`, so case, spacing and accent composition do not
 * split a circuit - and a session logged by typing the name of a track another
 * session does carry the row for folds into that row's key rather than opening
 * a second one. Two sessions `sessionsMatchTrack` calls equal must land on the
 * same key, or a rider reads two personal bests for one circuit.
 */
function buildSessionTrackKeys(sessions: readonly Session[]): Map<string, ResolvedTrack> {
  const resolved = new Map<string, ResolvedTrack>();
  const byKey = new Map<string, ResolvedTrack>();
  const savedByName = new Map<string, ResolvedTrack>();

  // Sessions carrying a track row first, so the name-only pass has somewhere to fold into.
  for (const session of sessions) {
    if (!session.track_id) continue;

    const key = `id:${session.track_id}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { key, trackName: session.track_name?.trim() || UNNAMED_TRACK };
      byKey.set(key, entry);
    }
    resolved.set(session.id, entry);

    const nameKey = trackNameKey(session.track_name);
    if (nameKey && !savedByName.has(nameKey)) savedByName.set(nameKey, entry);
  }

  for (const session of sessions) {
    if (session.track_id) continue;

    const nameKey = trackNameKey(session.track_name);
    if (!nameKey) {
      // Nothing links this session to another, so it gets a key of its own.
      // Every one of them once shared the key `unknown`, which put separate
      // track days on one board row: only the fastest survived, and the row
      // named a circuit the rider had never been to. `createSession` refuses
      // this state now, but the rows logged before it did still exist.
      resolved.set(session.id, {
        key: `unknown:${session.id}`,
        trackName: unnamedTrackLabel(session),
      });
      continue;
    }

    const saved = savedByName.get(nameKey);
    if (saved) {
      resolved.set(session.id, saved);
      continue;
    }

    const key = `name:${nameKey}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { key, trackName: session.track_name?.trim() || UNNAMED_TRACK };
      byKey.set(key, entry);
    }
    resolved.set(session.id, entry);
  }

  return resolved;
}

export function deriveSessionAnalytics(inputs: SessionExportInput[]): SessionAnalyticsSummary {
  const byVehicle = new Map<string, number>();
  const vehicleLabels = new Map<string, string>();
  const byTrack = new Map<string, number>();
  const moduleCounts = new Map<keyof SessionEnabledModules, number>();
  const ambientTemps: number[] = [];
  const trackTemps: number[] = [];
  const trackBests = new Map<string, AnalyticsTrackBest>();
  const lastRunByBoardRow = new Map<string, string>();
  let withEnvironment = 0;
  let totalLaps = 0;
  let sessionsWithLaps = 0;

  const trackKeys = buildSessionTrackKeys(inputs.map((input) => input.session));

  const ordered = [...inputs].sort((a, b) =>
    `${a.session.date} ${a.session.start_time ?? ''}`.localeCompare(`${b.session.date} ${b.session.start_time ?? ''}`),
  );

  for (const input of inputs) {
    const label = input.vehicle?.nickname ?? 'Unknown Vehicle';
    vehicleLabels.set(input.session.vehicle_id, label);
    increment(byVehicle, input.session.vehicle_id);
    increment(byTrack, input.session.track_name ?? 'Unknown Track');

    const enabled = getEnabledModules(input.session, input.vehicle);
    for (const [module, isEnabled] of Object.entries(enabled) as [keyof SessionEnabledModules, boolean][]) {
      if (isEnabled) increment(moduleCounts, module);
    }

    const { bestLapMs, lapCount } = extractLapMetrics(input.telemetry);
    if (lapCount !== null && lapCount > 0) {
      totalLaps += lapCount;
      sessionsWithLaps += 1;
    }

    const track = trackKeys.get(input.session.id);
    if (track) {
      // A row is one vehicle at one circuit, because that is the pair the app
      // already calls comparable. Sharing a row across vehicles hid the slower
      // one's personal best entirely.
      const rowKey = `${track.key}|${input.session.vehicle_id}`;

      // The board is ordered by when the rider was last out on that vehicle at
      // that circuit, so the date advances on every session there - not only on
      // the ones with laps.
      lastRunByBoardRow.set(
        rowKey,
        maxDate(lastRunByBoardRow.get(rowKey) ?? input.session.date, input.session.date),
      );

      const existing = trackBests.get(rowKey);
      if (bestLapMs !== null && (!existing || bestLapMs < existing.bestLapMs)) {
        trackBests.set(rowKey, {
          key: rowKey,
          trackName: track.trackName,
          bestLapMs,
          bestLap: formatLapTime(bestLapMs),
          sessionId: input.session.id,
          vehicleId: input.session.vehicle_id,
          vehicleLabel: label,
          lastRunDate: input.session.date,
        });
      }
    }

    if (input.environment) {
      withEnvironment += 1;
      if (typeof input.environment.ambient_temperature_c === 'number') {
        ambientTemps.push(input.environment.ambient_temperature_c);
      }
      if (typeof input.environment.track_temperature_c === 'number') {
        trackTemps.push(input.environment.track_temperature_c);
      }
    }
  }

  const pressureTracks = new Map<string, string[]>();
  for (const input of ordered) {
    const enabled = getEnabledModules(input.session, input.vehicle);
    if (!enabled.tires) continue;

    const label = input.vehicle?.nickname ?? 'Unknown Vehicle';
    const vehicleKey = `${input.session.vehicle_id}:${label}`;
    const frontKey = `${vehicleKey} front`;
    const rearKey = `${vehicleKey} rear`;
    const front = parsePressure(input.session.tires.front.pressure);
    const rear = parsePressure(input.session.tires.rear.pressure);
    if (front) pressureTracks.set(frontKey, [...(pressureTracks.get(frontKey) ?? []), front]);
    if (rear) pressureTracks.set(rearKey, [...(pressureTracks.get(rearKey) ?? []), rear]);
  }

  return {
    totalSessions: inputs.length,
    laps: { totalLaps, sessionsWithLaps },
    // Every pair, not the newest few. This board is the only place a personal
    // best appears, and a list cut short with nothing on screen saying so reads
    // as the whole set - a rider lapping an eighth circuit silently lost the
    // three they had ridden least recently. Raising the cap moves that cliff
    // rather than removing it, so there is none; the ordering below already
    // puts the most recent pair first.
    bestLapByTrack: [...trackBests.values()]
      .map((best) => ({ ...best, lastRunDate: lastRunByBoardRow.get(best.key) ?? best.lastRunDate }))
      .sort((a, b) => {
        if (a.lastRunDate !== b.lastRunDate) return a.lastRunDate < b.lastRunDate ? 1 : -1;
        return a.trackName.localeCompare(b.trackName) || a.vehicleLabel.localeCompare(b.vehicleLabel);
      }),
    sessionsByVehicle: [...byVehicle.entries()]
      .map(([vehicleId, count]) => ({ vehicleId, label: vehicleLabels.get(vehicleId) ?? 'Unknown Vehicle', count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    topTracks: [...byTrack.entries()]
      .map(([trackName, count]) => ({ trackName, count }))
      .sort((a, b) => b.count - a.count || a.trackName.localeCompare(b.trackName))
      .slice(0, 5),
    moduleCoverage: coverageRows(
      [
        ...MODULE_COVERAGE_ORDER.map((module) => [module, moduleCounts.get(module) ?? 0] as const),
        ['environment', withEnvironment] as const,
        ['lap_times', sessionsWithLaps] as const,
      ],
      inputs.length,
    ),
    tirePressureTrends: [...pressureTracks.entries()]
      .filter(([, values]) => values.length > 0)
      .map(([key, values]) => ({
        label: key.replace(/^[^:]+:/, ''),
        samples: values.length,
        first: values[0],
        latest: values[values.length - 1],
      }))
      .slice(0, 6),
    environmentSnapshots: {
      withEnvironment,
      averageAmbientTemperatureC: average(ambientTemps),
      averageTrackTemperatureC: average(trackTemps),
    },
  };
}
