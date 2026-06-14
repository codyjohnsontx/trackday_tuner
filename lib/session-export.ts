import { resolveSessionEnabledModules } from '@/lib/session-modules';
import type {
  Session,
  SessionEnabledModules,
  SessionEnvironment,
  Vehicle,
} from '@/types';

export interface SessionExportInput {
  session: Session;
  vehicle: Vehicle | null;
  environment: SessionEnvironment | null;
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

export function flattenSessionForExport({
  session,
  vehicle,
  environment,
}: SessionExportInput): SessionExportRow {
  const enabled = getEnabledModules(session, vehicle);
  const geometry = session.extra_modules?.geometry;
  const drivetrain = session.extra_modules?.drivetrain;
  const aero = session.extra_modules?.aero;

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
  const raw = String(value);
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

export interface SessionAnalyticsSummary {
  totalSessions: number;
  sessionsByVehicle: { vehicleId: string; label: string; count: number }[];
  topTracks: { trackName: string; count: number }[];
  moduleCoverage: { module: keyof SessionEnabledModules; count: number; percent: number }[];
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

export function deriveSessionAnalytics(inputs: SessionExportInput[]): SessionAnalyticsSummary {
  const byVehicle = new Map<string, number>();
  const vehicleLabels = new Map<string, string>();
  const byTrack = new Map<string, number>();
  const moduleCounts = new Map<keyof SessionEnabledModules, number>();
  const ambientTemps: number[] = [];
  const trackTemps: number[] = [];
  let withEnvironment = 0;

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
    const label = input.vehicle?.nickname ?? 'Unknown Vehicle';
    const front = parsePressure(input.session.tires.front.pressure);
    const rear = parsePressure(input.session.tires.rear.pressure);
    if (front) pressureTracks.set(`${label} front`, [...(pressureTracks.get(`${label} front`) ?? []), front]);
    if (rear) pressureTracks.set(`${label} rear`, [...(pressureTracks.get(`${label} rear`) ?? []), rear]);
  }

  return {
    totalSessions: inputs.length,
    sessionsByVehicle: [...byVehicle.entries()]
      .map(([vehicleId, count]) => ({ vehicleId, label: vehicleLabels.get(vehicleId) ?? 'Unknown Vehicle', count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    topTracks: [...byTrack.entries()]
      .map(([trackName, count]) => ({ trackName, count }))
      .sort((a, b) => b.count - a.count || a.trackName.localeCompare(b.trackName))
      .slice(0, 5),
    moduleCoverage: (['tires', 'suspension', 'alignment', 'geometry', 'drivetrain', 'aero', 'notes'] as const)
      .map((module) => {
        const count = moduleCounts.get(module) ?? 0;
        return {
          module,
          count,
          percent: inputs.length === 0 ? 0 : Math.round((count / inputs.length) * 100),
        };
      }),
    tirePressureTrends: [...pressureTracks.entries()]
      .filter(([, values]) => values.length > 0)
      .map(([label, values]) => ({
        label,
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
