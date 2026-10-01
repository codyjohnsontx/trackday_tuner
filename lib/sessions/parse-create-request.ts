import { isUuid } from '@/lib/rag/validation';
import { SETUP_FIELDS, type SetupField } from '@/lib/stored-session';
import type {
  Alignment,
  CreateSessionEnvironmentInput,
  CreateSessionInput,
  CreateSessionLapInput,
  ExtraModules,
  SessionEnabledModules,
  Suspension,
  SuspensionEnd,
  TireEnd,
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
 * field nobody reads. Which keys a setup blob may hold comes from `SETUP_FIELDS`,
 * the list the screens read a stored session through.
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

/**
 * The setup fields stored directly under `container`, by their own key -
 * `fieldsUnder('tires.front')` is brand, compound and pressure. They are read
 * off `SETUP_FIELDS` (lib/stored-session.ts), the one list every screen is built
 * from, so the phone can send exactly the fields a session can show and a field
 * added there is accepted here without a second list to remember.
 */
function fieldsUnder(container: string): Map<string, SetupField> {
  const prefix = `${container}.`;
  const fields = new Map<string, SetupField>();
  for (const field of SETUP_FIELDS) {
    const key = field.id.startsWith(prefix) ? field.id.slice(prefix.length) : '';
    if (key && !key.includes('.')) fields.set(key, field);
  }
  return fields;
}

/** A setup blob that may hold its own fields, the `extraKeys` named, and nothing else. */
function setupRecord(value: unknown, container: string, extraKeys: readonly string[] = []): Record<string, unknown> {
  return record(value, container, [...fieldsUnder(container).keys(), ...extraKeys]);
}

/**
 * `container`'s own setup fields out of `source`. When `required`, every field
 * has to be there - tyres, suspension and alignment store every one of theirs -
 * so a typed value is a string and a choice is one of its options. Otherwise a
 * typed value is a string when sent - an advanced module stores only those the
 * rider filled in - and a choice is one of its options or null for not logged.
 */
function setupLeaves(source: Record<string, unknown>, container: string, required: boolean): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, field] of fieldsUnder(container)) {
    const path = `${container}.${key}`;
    const leaf = source[key];
    if (field.kind === 'choice') {
      const options = field.options ?? [];
      if (required) {
        if (!options.includes(leaf as string)) fail(`${path} must be ${options.join(' or ')}.`);
        out[key] = leaf as string;
      } else {
        if (leaf != null && !options.includes(leaf as string)) fail(`${path} must be one of ${options.join(', ')}, or null.`);
        out[key] = (leaf as string | null | undefined) ?? null;
      }
    } else if (required || leaf !== undefined) {
      out[key] = string(leaf, path);
    }
  }
  return out;
}

function parseTires(value: unknown): Tires {
  const tires = setupRecord(value, 'tires', ['front', 'rear']);
  const end = (side: 'front' | 'rear'): TireEnd => {
    const path = `tires.${side}`;
    // The hot pressure is read after the session rather than set before it, so
    // it is not a setup field - but it is stored when the phone sends one.
    const source = setupRecord(tires[side], path, ['hot_pressure']);
    const hot = optionalString(source.hot_pressure, `${path}.hot_pressure`);
    const leaves = setupLeaves(source, path, true) as unknown as TireEnd;
    return { ...leaves, ...(hot === undefined ? {} : { hot_pressure: hot }) };
  };
  // The tyre condition is the one answer a rider may leave unlogged.
  const own = setupLeaves(tires, 'tires', false) as unknown as Pick<Tires, 'condition'>;
  return { front: end('front'), rear: end('rear'), ...own };
}

function parseSuspension(value: unknown): Suspension {
  const suspension = record(value, 'suspension', ['front', 'rear']);
  const end = (side: 'front' | 'rear'): SuspensionEnd => {
    const path = `suspension.${side}`;
    return setupLeaves(setupRecord(suspension[side], path), path, true) as unknown as SuspensionEnd;
  };
  return { front: end('front'), rear: end('rear') };
}

function parseAlignment(value: unknown): Alignment | null {
  if (value == null) return null;
  return setupLeaves(setupRecord(value, 'alignment'), 'alignment', true) as unknown as Alignment;
}

/** The advanced modules, off the same list: geometry, drivetrain and aero. */
const EXTRA_MODULES = [
  ...new Set(SETUP_FIELDS.filter((field) => field.id.startsWith('extra_modules.')).map((field) => field.module)),
] as (keyof ExtraModules)[];

function parseExtraModules(value: unknown): ExtraModules | null {
  if (value == null) return null;
  const source = record(value, 'extra_modules', EXTRA_MODULES);
  const out: ExtraModules = {};
  for (const name of EXTRA_MODULES) {
    if (source[name] === undefined) continue;
    const path = `extra_modules.${name}`;
    out[name] = setupLeaves(setupRecord(source[name], path), path, false) as Record<string, string>;
  }
  return out;
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
