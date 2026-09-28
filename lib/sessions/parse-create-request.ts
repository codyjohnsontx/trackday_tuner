import { isUuid } from '@/lib/rag/validation';
import type {
  Alignment,
  CreateSessionEnvironmentInput,
  CreateSessionInput,
  CreateSessionLapInput,
  ExtraModules,
  SessionEnabledModules,
  Suspension,
  Tires,
} from '@/types';

/**
 * The body of `POST /api/mobile/sessions`, checked into a `CreateSessionInput`
 * and the client-supplied id.
 *
 * The server action trusts its TypeScript types because the only thing that
 * calls it is the website's own form. This body comes off the network from a
 * separate app, and `sessions.tires`, `suspension`, `alignment` and
 * `extra_modules` are shape-unconstrained `jsonb`: whatever arrives is stored
 * verbatim, and a number where a screen expects a string takes the sessions list
 * down (see "The same unconstrained column" in CLAUDE.md). So every leaf of those
 * blobs is required to be the type its TypeScript declares, and an unknown key is
 * refused rather than stored, so a typo in the app surfaces as a 400 instead of a
 * field nobody reads.
 *
 * Rules `createSessionForUser` already applies - the weather answer, the track
 * name, lap validity - are left to it, so each has one copy and one message.
 * Here a field only has to be the right TYPE for that function to judge it.
 */
export type ParsedCreateRequest = { id: string; input: CreateSessionInput };
export type ParseResult = { ok: true; data: ParsedCreateRequest } | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const SMALLINT_MIN = -32768;
const SMALLINT_MAX = 32767;

/** A day the `date` column accepts: no February 30th, and no year zero. */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const TOP_LEVEL_KEYS = new Set([
  'id',
  'vehicle_id',
  'track_id',
  'track_name',
  'layout_id',
  'date',
  'start_time',
  'session_number',
  'conditions',
  'tires',
  'suspension',
  'alignment',
  'enabled_modules',
  'extra_modules',
  'environment',
  'notes',
  'laps',
]);

class InvalidField extends Error {}

function fail(message: string): never {
  throw new InvalidField(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) fail(`Unknown field: ${path}.${unknown}.`);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(`${path} must be a string.`);
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : string(value, path);
}

function nullableString(value: unknown, path: string): string | null {
  return value == null ? null : string(value, path);
}

function nullableUuid(value: unknown, path: string): string | null {
  if (value == null) return null;
  if (!isUuid(value)) fail(`${path} must be a UUID or null.`);
  return value;
}

function nullableNumber(value: unknown, path: string): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${path} must be a number or null.`);
  return value;
}

/** Every key present and a string, or every key absent - the only two shapes a
 * stored blob of this kind has. */
function stringLeaves<K extends string>(value: unknown, path: string, keys: readonly K[]): Record<K, string> {
  const source = record(value, path, keys);
  const out = {} as Record<K, string>;
  for (const key of keys) out[key] = string(source[key], `${path}.${key}`);
  return out;
}

function optionalStringLeaves(value: unknown, path: string, keys: readonly string[]): Record<string, string> {
  const source = record(value, path, keys);
  const out: Record<string, string> = {};
  for (const key of keys) {
    const leaf = optionalString(source[key], `${path}.${key}`);
    if (leaf !== undefined) out[key] = leaf;
  }
  return out;
}

const TIRE_CONDITIONS = ['new', 'scrubbed', 'used', 'worn'] as const;

function parseTires(value: unknown): Tires {
  const tires = record(value, 'tires', ['front', 'rear', 'condition']);
  const end = (side: 'front' | 'rear') => {
    const path = `tires.${side}`;
    const source = record(tires[side], path, ['brand', 'compound', 'pressure', 'hot_pressure']);
    const hot = optionalString(source.hot_pressure, `${path}.hot_pressure`);
    return {
      brand: string(source.brand, `${path}.brand`),
      compound: string(source.compound, `${path}.compound`),
      pressure: string(source.pressure, `${path}.pressure`),
      ...(hot === undefined ? {} : { hot_pressure: hot }),
    };
  };
  const condition = tires.condition ?? null;
  if (condition !== null && !TIRE_CONDITIONS.includes(condition as (typeof TIRE_CONDITIONS)[number])) {
    fail('tires.condition must be one of new, scrubbed, used, worn, or null.');
  }
  return { front: end('front'), rear: end('rear'), condition: condition as Tires['condition'] };
}

function parseSuspension(value: unknown): Suspension {
  const suspension = record(value, 'suspension', ['front', 'rear']);
  const end = (side: 'front' | 'rear') => {
    const path = `suspension.${side}`;
    const leaves = stringLeaves(suspension[side], path, ['preload', 'compression', 'rebound', 'direction']);
    const { direction } = leaves;
    if (direction !== 'in' && direction !== 'out') fail(`${path}.direction must be in or out.`);
    return { ...leaves, direction: direction as 'in' | 'out' };
  };
  return { front: end('front'), rear: end('rear') };
}

function parseAlignment(value: unknown): Alignment | null {
  if (value == null) return null;
  return stringLeaves(value, 'alignment', ['front_camber', 'rear_camber', 'front_toe', 'rear_toe', 'caster']);
}

const MODULE_KEYS = ['tires', 'suspension', 'alignment', 'geometry', 'drivetrain', 'aero', 'notes'] as const;

function parseEnabledModules(value: unknown): SessionEnabledModules | null {
  if (value == null) return null;
  const source = record(value, 'enabled_modules', MODULE_KEYS);
  const out = {} as SessionEnabledModules;
  for (const key of MODULE_KEYS) {
    if (typeof source[key] !== 'boolean') fail(`enabled_modules.${key} must be a boolean.`);
    out[key] = source[key] as boolean;
  }
  return out;
}

function parseExtraModules(value: unknown): ExtraModules | null {
  if (value == null) return null;
  const source = record(value, 'extra_modules', ['geometry', 'drivetrain', 'aero']);
  const out: ExtraModules = {};
  if (source.geometry !== undefined) {
    out.geometry = optionalStringLeaves(source.geometry, 'extra_modules.geometry', [
      'sag_front',
      'sag_rear',
      'fork_height',
      'rear_ride_height',
      'notes',
    ]);
  }
  if (source.drivetrain !== undefined) {
    out.drivetrain = optionalStringLeaves(source.drivetrain, 'extra_modules.drivetrain', [
      'front_sprocket',
      'rear_sprocket',
      'chain_length',
      'notes',
    ]);
  }
  if (source.aero !== undefined) {
    out.aero = optionalStringLeaves(source.aero, 'extra_modules.aero', ['wing_angle', 'splitter_setting', 'rake', 'notes']);
  }
  return out;
}

const ENVIRONMENT_SOURCES = ['manual', 'forecast', 'telemetry'] as const;

function parseEnvironment(value: unknown): CreateSessionEnvironmentInput | null {
  if (value == null) return null;
  const source = record(value, 'environment', [
    'ambient_temperature_c',
    'track_temperature_c',
    'humidity_percent',
    'weather_condition',
    'surface_condition',
    'source',
  ]);
  if (source.source != null && !ENVIRONMENT_SOURCES.includes(source.source as (typeof ENVIRONMENT_SOURCES)[number])) {
    fail('environment.source must be one of manual, forecast, telemetry.');
  }
  const humidity = nullableNumber(source.humidity_percent, 'environment.humidity_percent');
  if (humidity !== null && (humidity < 0 || humidity > 100)) {
    fail('environment.humidity_percent must be from 0 to 100, or null.');
  }
  return {
    ambient_temperature_c: nullableNumber(source.ambient_temperature_c, 'environment.ambient_temperature_c'),
    track_temperature_c: nullableNumber(source.track_temperature_c, 'environment.track_temperature_c'),
    humidity_percent: humidity,
    weather_condition: nullableString(source.weather_condition, 'environment.weather_condition'),
    surface_condition: nullableString(source.surface_condition, 'environment.surface_condition'),
    ...(source.source != null ? { source: source.source as CreateSessionEnvironmentInput['source'] } : {}),
  };
}

function parseLaps(value: unknown): CreateSessionLapInput[] {
  if (value == null) return [];
  if (!Array.isArray(value)) fail('laps must be an array.');
  return value.map((lap, index) => {
    const path = `laps[${index}]`;
    const source = record(lap, path, ['lap_number', 'lap_time_ms', 'included']);
    if (typeof source.lap_number !== 'number') fail(`${path}.lap_number must be a number.`);
    if (typeof source.lap_time_ms !== 'number') fail(`${path}.lap_time_ms must be a number.`);
    if (typeof source.included !== 'boolean') fail(`${path}.included must be a boolean.`);
    return { lap_number: source.lap_number, lap_time_ms: source.lap_time_ms, included: source.included };
  });
}

export function parseCreateSessionRequest(body: unknown): ParseResult {
  try {
    if (!isRecord(body)) fail('Request body must be an object.');
    const unknown = Object.keys(body).find((key) => !TOP_LEVEL_KEYS.has(key));
    if (unknown) fail(`Unknown field: ${unknown}.`);

    if (!isUuid(body.id)) fail('id must be a UUID.');
    if (!isUuid(body.vehicle_id)) fail('vehicle_id must be a UUID.');
    if (!isCalendarDate(body.date)) fail('date must be a real calendar day as YYYY-MM-DD.');
    const startTime = nullableString(body.start_time, 'start_time');
    if (startTime !== null && !TIME.test(startTime)) fail('start_time must be a 24-hour HH:MM or HH:MM:SS, or null.');
    if (
      body.session_number != null &&
      !(
        Number.isInteger(body.session_number) &&
        (body.session_number as number) >= SMALLINT_MIN &&
        (body.session_number as number) <= SMALLINT_MAX
      )
    ) {
      fail(`session_number must be an integer from ${SMALLINT_MIN} to ${SMALLINT_MAX}, or null.`);
    }

    const input: CreateSessionInput = {
      vehicle_id: body.vehicle_id,
      track_id: nullableUuid(body.track_id, 'track_id'),
      track_name: nullableString(body.track_name, 'track_name'),
      layout_id: nullableUuid(body.layout_id, 'layout_id'),
      date: body.date,
      start_time: startTime,
      session_number: (body.session_number as number | null | undefined) ?? null,
      // Judged by `createSessionForUser`, which owns the message for a missing
      // answer; anything that is not one of the four fails there the same way.
      conditions: body.conditions as CreateSessionInput['conditions'],
      tires: parseTires(body.tires),
      suspension: parseSuspension(body.suspension),
      alignment: parseAlignment(body.alignment),
      enabled_modules: parseEnabledModules(body.enabled_modules),
      extra_modules: parseExtraModules(body.extra_modules),
      environment: parseEnvironment(body.environment),
      notes: nullableString(body.notes, 'notes'),
      laps: parseLaps(body.laps),
    };

    return { ok: true, data: { id: body.id, input } };
  } catch (error) {
    if (error instanceof InvalidField) return { ok: false, error: error.message };
    throw error;
  }
}
