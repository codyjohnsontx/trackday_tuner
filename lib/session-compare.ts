import { resolveSessionEnabledModules } from '@/lib/session-modules';
import type { Session, SessionEnvironment, TelemetrySummary, VehicleType } from '@/types';

export const COMPARABLE_SESSION_LIMIT = 20;
export const COMPARABLE_SESSION_FETCH_LIMIT = COMPARABLE_SESSION_LIMIT * 3;

export type ComparisonStrength = 'strong' | 'useful' | 'weak';

export interface LapMetrics {
  bestLapMs: number | null;
  averageLapMs: number | null;
  lapCount: number | null;
  consistencySpreadMs: number | null;
}

export interface LapMetricDeltas {
  bestLapMs: number | null;
  averageLapMs: number | null;
  lapCount: number | null;
  consistencySpreadMs: number | null;
}

export interface ContextFlag {
  key: string;
  severity: 'info' | 'warning' | 'critical';
  label: string;
  detail: string;
}

export interface SetupCompareRow {
  group: string;
  label: string;
  current: string;
  baseline: string;
  changed: boolean;
}

export interface SessionComparisonModel {
  strength: ComparisonStrength;
  summary: string;
  flags: ContextFlag[];
  lapMetrics: {
    current: LapMetrics;
    baseline: LapMetrics;
    deltas: LapMetricDeltas;
  };
  setupRows: SetupCompareRow[];
}

interface BuildContext {
  currentSession: Session;
  baselineSession: Session;
  currentEnvironment?: SessionEnvironment | null;
  baselineEnvironment?: SessionEnvironment | null;
  currentTelemetry?: TelemetrySummary | null;
  baselineTelemetry?: TelemetrySummary | null;
  vehicleType?: VehicleType;
}

const emptyLapMetrics: LapMetrics = {
  bestLapMs: null,
  averageLapMs: null,
  lapCount: null,
  consistencySpreadMs: null,
};

function validNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function sessionsMatchTrack(a: Session, b: Session): boolean {
  if (a.track_id && b.track_id) return a.track_id === b.track_id;

  const aTrackName = a.track_name?.trim();
  const bTrackName = b.track_name?.trim();
  return Boolean(aTrackName && bTrackName && aTrackName === bTrackName);
}

function sessionTimeValue(session: Session): string {
  return `${session.date}T${session.start_time ?? '00:00:00'}`;
}

export function compareSessionsDesc(a: Session, b: Session): number {
  const timeComparison = sessionTimeValue(b).localeCompare(sessionTimeValue(a));
  if (timeComparison !== 0) return timeComparison;

  const createdAtComparison = b.created_at.localeCompare(a.created_at);
  if (createdAtComparison !== 0) return createdAtComparison;

  return b.id.localeCompare(a.id);
}

export function isSessionBefore(candidate: Session, current: Session): boolean {
  const timeComparison = sessionTimeValue(candidate).localeCompare(sessionTimeValue(current));
  if (timeComparison !== 0) return timeComparison < 0;

  const createdAtComparison = candidate.created_at.localeCompare(current.created_at);
  if (createdAtComparison !== 0) return createdAtComparison < 0;

  return candidate.id.localeCompare(current.id) < 0;
}

function sessionLabel(session: Session): string {
  return session.session_number ? `Session ${session.session_number}` : 'Current session';
}

function baselineLabel(session: Session): string {
  return session.session_number ? `Session ${session.session_number}` : 'the baseline session';
}

function value(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function moduleValue(enabled: boolean, valueToShow: string | null | undefined): string {
  return enabled ? value(valueToShow) : '';
}

function addRow(rows: SetupCompareRow[], group: string, label: string, current: string, baseline: string) {
  rows.push({
    group,
    label,
    current,
    baseline,
    changed: current !== baseline,
  });
}

function delta(current: number | null, baseline: number | null): number | null {
  return current !== null && baseline !== null ? current - baseline : null;
}

function formatDeltaC(valueDelta: number): string {
  const prefix = valueDelta > 0 ? '+' : '';
  return `${prefix}${valueDelta.toFixed(0)}C`;
}

function hasLapSignal(metrics: LapMetrics): boolean {
  return (
    metrics.bestLapMs !== null ||
    metrics.averageLapMs !== null ||
    metrics.lapCount !== null ||
    metrics.consistencySpreadMs !== null
  );
}

export function formatLapTime(ms: number | null | undefined): string {
  const validMs = validNumber(ms);
  if (validMs === null) return '—';

  const totalSeconds = validMs / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;

  if (minutes <= 0) return seconds.toFixed(3);
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
}

export function extractLapMetrics(summary: TelemetrySummary | null | undefined): LapMetrics {
  if (!summary) return { ...emptyLapMetrics };

  const metrics = summary.metrics ?? {};
  const lapTimes = Array.isArray(metrics.lap_times_ms)
    ? metrics.lap_times_ms.map(validNumber).filter((lapTime): lapTime is number => lapTime !== null)
    : [];

  const explicitBestLap = validNumber(metrics.best_lap_ms);
  const explicitAverageLap = validNumber(metrics.average_lap_ms);
  const explicitLapCount = validNumber(metrics.lap_count);
  const explicitSpread = validNumber(metrics.consistency_spread_ms);

  const computedBestLap = lapTimes.length > 0 ? Math.min(...lapTimes) : null;
  const computedAverageLap =
    lapTimes.length > 0 ? Math.round(lapTimes.reduce((sum, lapTime) => sum + lapTime, 0) / lapTimes.length) : null;
  const computedSpread = lapTimes.length > 0 ? Math.max(...lapTimes) - Math.min(...lapTimes) : null;

  return {
    bestLapMs: explicitBestLap ?? computedBestLap,
    averageLapMs: explicitAverageLap ?? computedAverageLap,
    lapCount: explicitLapCount ?? (lapTimes.length > 0 ? lapTimes.length : null),
    consistencySpreadMs: explicitSpread ?? computedSpread,
  };
}

export function buildSetupCompareRows(
  current: Session,
  baseline: Session,
  currentEnvironment?: SessionEnvironment | null,
  baselineEnvironment?: SessionEnvironment | null,
  vehicleType: VehicleType = 'motorcycle',
): SetupCompareRow[] {
  const rows: SetupCompareRow[] = [];
  const currentEnabled = resolveSessionEnabledModules(current, vehicleType);
  const baselineEnabled = resolveSessionEnabledModules(baseline, vehicleType);

  addRow(rows, 'Session info', 'Track', value(current.track_name), value(baseline.track_name));
  addRow(rows, 'Session info', 'Date', current.date, baseline.date);
  addRow(rows, 'Session info', 'Session number', value(current.session_number), value(baseline.session_number));
  addRow(rows, 'Session info', 'Conditions', current.conditions, baseline.conditions);
  addRow(rows, 'Session info', 'Start time', value(current.start_time), value(baseline.start_time));

  addRow(
    rows,
    'Environment',
    'Ambient temperature',
    currentEnvironment?.ambient_temperature_c != null ? `${currentEnvironment.ambient_temperature_c}C` : '',
    baselineEnvironment?.ambient_temperature_c != null ? `${baselineEnvironment.ambient_temperature_c}C` : '',
  );
  addRow(
    rows,
    'Environment',
    'Track temperature',
    currentEnvironment?.track_temperature_c != null ? `${currentEnvironment.track_temperature_c}C` : '',
    baselineEnvironment?.track_temperature_c != null ? `${baselineEnvironment.track_temperature_c}C` : '',
  );
  addRow(
    rows,
    'Environment',
    'Humidity',
    currentEnvironment?.humidity_percent != null ? `${currentEnvironment.humidity_percent}%` : '',
    baselineEnvironment?.humidity_percent != null ? `${baselineEnvironment.humidity_percent}%` : '',
  );
  addRow(rows, 'Environment', 'Weather', value(currentEnvironment?.weather_condition), value(baselineEnvironment?.weather_condition));
  addRow(rows, 'Environment', 'Surface', value(currentEnvironment?.surface_condition), value(baselineEnvironment?.surface_condition));

  if (currentEnabled.tires || baselineEnabled.tires) {
    addRow(rows, 'Tires', 'Condition', moduleValue(currentEnabled.tires, current.tires.condition), moduleValue(baselineEnabled.tires, baseline.tires.condition));
    addRow(rows, 'Tires', 'Front brand', moduleValue(currentEnabled.tires, current.tires.front.brand), moduleValue(baselineEnabled.tires, baseline.tires.front.brand));
    addRow(rows, 'Tires', 'Front compound', moduleValue(currentEnabled.tires, current.tires.front.compound), moduleValue(baselineEnabled.tires, baseline.tires.front.compound));
    addRow(rows, 'Tires', 'Front pressure', moduleValue(currentEnabled.tires, current.tires.front.pressure), moduleValue(baselineEnabled.tires, baseline.tires.front.pressure));
    addRow(rows, 'Tires', 'Rear brand', moduleValue(currentEnabled.tires, current.tires.rear.brand), moduleValue(baselineEnabled.tires, baseline.tires.rear.brand));
    addRow(rows, 'Tires', 'Rear compound', moduleValue(currentEnabled.tires, current.tires.rear.compound), moduleValue(baselineEnabled.tires, baseline.tires.rear.compound));
    addRow(rows, 'Tires', 'Rear pressure', moduleValue(currentEnabled.tires, current.tires.rear.pressure), moduleValue(baselineEnabled.tires, baseline.tires.rear.pressure));
  }

  if (currentEnabled.suspension || baselineEnabled.suspension) {
    addRow(rows, 'Suspension', 'Front direction', moduleValue(currentEnabled.suspension, current.suspension.front.direction), moduleValue(baselineEnabled.suspension, baseline.suspension.front.direction));
    addRow(rows, 'Suspension', 'Front preload', moduleValue(currentEnabled.suspension, current.suspension.front.preload), moduleValue(baselineEnabled.suspension, baseline.suspension.front.preload));
    addRow(rows, 'Suspension', 'Front compression', moduleValue(currentEnabled.suspension, current.suspension.front.compression), moduleValue(baselineEnabled.suspension, baseline.suspension.front.compression));
    addRow(rows, 'Suspension', 'Front rebound', moduleValue(currentEnabled.suspension, current.suspension.front.rebound), moduleValue(baselineEnabled.suspension, baseline.suspension.front.rebound));
    addRow(rows, 'Suspension', 'Rear direction', moduleValue(currentEnabled.suspension, current.suspension.rear.direction), moduleValue(baselineEnabled.suspension, baseline.suspension.rear.direction));
    addRow(rows, 'Suspension', 'Rear preload', moduleValue(currentEnabled.suspension, current.suspension.rear.preload), moduleValue(baselineEnabled.suspension, baseline.suspension.rear.preload));
    addRow(rows, 'Suspension', 'Rear compression', moduleValue(currentEnabled.suspension, current.suspension.rear.compression), moduleValue(baselineEnabled.suspension, baseline.suspension.rear.compression));
    addRow(rows, 'Suspension', 'Rear rebound', moduleValue(currentEnabled.suspension, current.suspension.rear.rebound), moduleValue(baselineEnabled.suspension, baseline.suspension.rear.rebound));
  }

  if (currentEnabled.alignment || baselineEnabled.alignment) {
    addRow(rows, 'Alignment', 'Front camber', moduleValue(currentEnabled.alignment, current.alignment?.front_camber), moduleValue(baselineEnabled.alignment, baseline.alignment?.front_camber));
    addRow(rows, 'Alignment', 'Rear camber', moduleValue(currentEnabled.alignment, current.alignment?.rear_camber), moduleValue(baselineEnabled.alignment, baseline.alignment?.rear_camber));
    addRow(rows, 'Alignment', 'Front toe', moduleValue(currentEnabled.alignment, current.alignment?.front_toe), moduleValue(baselineEnabled.alignment, baseline.alignment?.front_toe));
    addRow(rows, 'Alignment', 'Rear toe', moduleValue(currentEnabled.alignment, current.alignment?.rear_toe), moduleValue(baselineEnabled.alignment, baseline.alignment?.rear_toe));
    addRow(rows, 'Alignment', 'Caster', moduleValue(currentEnabled.alignment, current.alignment?.caster), moduleValue(baselineEnabled.alignment, baseline.alignment?.caster));
  }

  if (currentEnabled.geometry || baselineEnabled.geometry) {
    addRow(rows, 'Geometry', 'Front sag', moduleValue(currentEnabled.geometry, current.extra_modules?.geometry?.sag_front), moduleValue(baselineEnabled.geometry, baseline.extra_modules?.geometry?.sag_front));
    addRow(rows, 'Geometry', 'Rear sag', moduleValue(currentEnabled.geometry, current.extra_modules?.geometry?.sag_rear), moduleValue(baselineEnabled.geometry, baseline.extra_modules?.geometry?.sag_rear));
    addRow(rows, 'Geometry', 'Fork height', moduleValue(currentEnabled.geometry, current.extra_modules?.geometry?.fork_height), moduleValue(baselineEnabled.geometry, baseline.extra_modules?.geometry?.fork_height));
    addRow(rows, 'Geometry', 'Rear ride height', moduleValue(currentEnabled.geometry, current.extra_modules?.geometry?.rear_ride_height), moduleValue(baselineEnabled.geometry, baseline.extra_modules?.geometry?.rear_ride_height));
    addRow(rows, 'Geometry', 'Notes', moduleValue(currentEnabled.geometry, current.extra_modules?.geometry?.notes), moduleValue(baselineEnabled.geometry, baseline.extra_modules?.geometry?.notes));
  }

  if (currentEnabled.drivetrain || baselineEnabled.drivetrain) {
    addRow(rows, 'Drivetrain', 'Front sprocket', moduleValue(currentEnabled.drivetrain, current.extra_modules?.drivetrain?.front_sprocket), moduleValue(baselineEnabled.drivetrain, baseline.extra_modules?.drivetrain?.front_sprocket));
    addRow(rows, 'Drivetrain', 'Rear sprocket', moduleValue(currentEnabled.drivetrain, current.extra_modules?.drivetrain?.rear_sprocket), moduleValue(baselineEnabled.drivetrain, baseline.extra_modules?.drivetrain?.rear_sprocket));
    addRow(rows, 'Drivetrain', 'Chain length', moduleValue(currentEnabled.drivetrain, current.extra_modules?.drivetrain?.chain_length), moduleValue(baselineEnabled.drivetrain, baseline.extra_modules?.drivetrain?.chain_length));
    addRow(rows, 'Drivetrain', 'Notes', moduleValue(currentEnabled.drivetrain, current.extra_modules?.drivetrain?.notes), moduleValue(baselineEnabled.drivetrain, baseline.extra_modules?.drivetrain?.notes));
  }

  if (currentEnabled.aero || baselineEnabled.aero) {
    addRow(rows, 'Aero', 'Wing angle', moduleValue(currentEnabled.aero, current.extra_modules?.aero?.wing_angle), moduleValue(baselineEnabled.aero, baseline.extra_modules?.aero?.wing_angle));
    addRow(rows, 'Aero', 'Splitter setting', moduleValue(currentEnabled.aero, current.extra_modules?.aero?.splitter_setting), moduleValue(baselineEnabled.aero, baseline.extra_modules?.aero?.splitter_setting));
    addRow(rows, 'Aero', 'Rake', moduleValue(currentEnabled.aero, current.extra_modules?.aero?.rake), moduleValue(baselineEnabled.aero, baseline.extra_modules?.aero?.rake));
    addRow(rows, 'Aero', 'Notes', moduleValue(currentEnabled.aero, current.extra_modules?.aero?.notes), moduleValue(baselineEnabled.aero, baseline.extra_modules?.aero?.notes));
  }

  if (currentEnabled.notes || baselineEnabled.notes) {
    addRow(rows, 'Notes', 'Session notes', moduleValue(currentEnabled.notes, current.notes), moduleValue(baselineEnabled.notes, baseline.notes));
  }

  return rows;
}

export function buildContextFlags(context: BuildContext, currentLapMetrics: LapMetrics, baselineLapMetrics: LapMetrics): ContextFlag[] {
  const { currentSession, baselineSession, currentEnvironment, baselineEnvironment } = context;
  const flags: ContextFlag[] = [];

  if (!sessionsMatchTrack(currentSession, baselineSession)) {
    flags.push({
      key: 'track-mismatch',
      severity: 'critical',
      label: 'Track mismatch',
      detail: 'Different tracks make this a weak comparison signal.',
    });
  }

  if (currentSession.conditions !== baselineSession.conditions) {
    flags.push({
      key: 'condition-mismatch',
      severity: 'warning',
      label: 'Condition mismatch',
      detail: `Conditions changed from ${baselineSession.conditions} to ${currentSession.conditions}.`,
    });
  }

  if (!currentEnvironment || !baselineEnvironment) {
    flags.push({
      key: 'missing-environment',
      severity: 'warning',
      label: 'Missing environment',
      detail: 'One or both sessions are missing environment data.',
    });
  } else {
    const ambientDelta = delta(currentEnvironment.ambient_temperature_c, baselineEnvironment.ambient_temperature_c);
    if (ambientDelta !== null && Math.abs(ambientDelta) >= 5) {
      flags.push({
        key: 'ambient-temperature-delta',
        severity: 'warning',
        label: 'Ambient temperature delta',
        detail: `Ambient temperature changed by ${formatDeltaC(ambientDelta)}.`,
      });
    }

    const trackDelta = delta(currentEnvironment.track_temperature_c, baselineEnvironment.track_temperature_c);
    if (trackDelta !== null && Math.abs(trackDelta) >= 8) {
      flags.push({
        key: 'track-temperature-delta',
        severity: 'warning',
        label: 'Track temperature delta',
        detail: `Track temperature changed by ${formatDeltaC(trackDelta)}.`,
      });
    }
  }

  if (currentSession.tires.condition !== baselineSession.tires.condition) {
    flags.push({
      key: 'tire-condition-mismatch',
      severity: 'warning',
      label: 'Tire condition mismatch',
      detail: `Tire condition changed from ${baselineSession.tires.condition} to ${currentSession.tires.condition}.`,
    });
  }

  const compoundChanged =
    currentSession.tires.front.compound !== baselineSession.tires.front.compound ||
    currentSession.tires.rear.compound !== baselineSession.tires.rear.compound;
  if (compoundChanged) {
    flags.push({
      key: 'tire-compound-mismatch',
      severity: 'warning',
      label: 'Tire compound mismatch',
      detail: 'Front or rear compound changed between sessions.',
    });
  }

  if (!hasLapSignal(currentLapMetrics) || !hasLapSignal(baselineLapMetrics)) {
    flags.push({
      key: 'lap-data-missing',
      severity: 'info',
      label: 'Lap data missing',
      detail: 'One or both sessions are missing structured lap metrics.',
    });
  }

  const notes = `${currentSession.notes ?? ''} ${baselineSession.notes ?? ''}`.toLowerCase();
  const noteSignals = [
    ['traffic', 'traffic'],
    ['red flag', 'red flag'],
    ['rain', 'rain'],
    ['mechanical', 'mechanical issue'],
    ['crash', 'crash or off-track'],
    ['off-track', 'crash or off-track'],
    ['limited laps', 'limited laps'],
  ] as const;
  const matchedSignals = new Set<string>();
  for (const [needle, label] of noteSignals) {
    if (notes.includes(needle)) matchedSignals.add(label);
  }
  if (matchedSignals.size > 0) {
    flags.push({
      key: 'notes-context',
      severity: 'warning',
      label: 'Notes context',
      detail: `Notes mention ${Array.from(matchedSignals).join(', ')}.`,
    });
  }

  return flags;
}

export function assignComparisonStrength(context: BuildContext, flags: ContextFlag[]): ComparisonStrength {
  if (!sessionsMatchTrack(context.currentSession, context.baselineSession)) return 'weak';

  const criticalCount = flags.filter((flag) => flag.severity === 'critical').length;
  const warningCount = flags.filter((flag) => flag.severity === 'warning').length;
  const hasLapMissing = flags.some((flag) => flag.key === 'lap-data-missing');

  if (criticalCount > 0 || warningCount >= 4) return 'weak';
  if (warningCount === 0 && !hasLapMissing) return 'strong';
  return 'useful';
}

export function generateComparisonSummary(context: BuildContext, strength: ComparisonStrength, flags: ContextFlag[]): string {
  const currentLabel = sessionLabel(context.currentSession);
  const baseline = baselineLabel(context.baselineSession);
  const setupChangesVisible = buildSetupCompareRows(
    context.currentSession,
    context.baselineSession,
    context.currentEnvironment,
    context.baselineEnvironment,
    context.vehicleType,
  ).some((row) => row.changed);

  const constraint =
    flags.find((flag) => flag.severity === 'critical' || flag.severity === 'warning') ??
    flags.find((flag) => flag.key === 'lap-data-missing');

  const firstSentence = `${currentLabel} is a ${strength} comparison signal against ${baseline}.`;
  const setupSentence = setupChangesVisible
    ? 'Setup changes are visible in the logged fields.'
    : 'Logged setup fields are mostly unchanged.';
  const constraintSentence = constraint
    ? `${constraint.label} weakens the read.`
    : 'Context is close enough for a cleaner read.';

  return `${firstSentence} ${setupSentence} ${constraintSentence}`;
}

export function buildSessionComparisonModel(context: BuildContext): SessionComparisonModel {
  const current = extractLapMetrics(context.currentTelemetry);
  const baseline = extractLapMetrics(context.baselineTelemetry);
  const flags = buildContextFlags(context, current, baseline);
  const strength = assignComparisonStrength(context, flags);

  return {
    strength,
    summary: generateComparisonSummary(context, strength, flags),
    flags,
    lapMetrics: {
      current,
      baseline,
      deltas: {
        bestLapMs: delta(current.bestLapMs, baseline.bestLapMs),
        averageLapMs: delta(current.averageLapMs, baseline.averageLapMs),
        lapCount: delta(current.lapCount, baseline.lapCount),
        consistencySpreadMs: delta(current.consistencySpreadMs, baseline.consistencySpreadMs),
      },
    },
    setupRows: buildSetupCompareRows(
      context.currentSession,
      context.baselineSession,
      context.currentEnvironment,
      context.baselineEnvironment,
      context.vehicleType,
    ),
  };
}
