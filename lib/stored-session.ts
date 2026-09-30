import type {
  AeroModule,
  Alignment,
  DrivetrainModule,
  ExtraModules,
  GeometryModule,
  Session,
  SessionEnabledModules,
  SessionModuleKey,
  Suspension,
  SuspensionDirection,
  SuspensionEnd,
  TireCondition,
  TireEnd,
  Tires,
} from '@/types';

/**
 * The stored-session read model: the one place a `sessions` row becomes a
 * `Session`.
 *
 * `sessions.tires`, `suspension`, `alignment`, `enabled_modules` and
 * `extra_modules` are shape-unconstrained `jsonb`. The website save inserts the
 * blob it is handed, and `authenticated` can write the table directly, so the
 * `Session` type's string leaves were a claim about the code that wrote a row,
 * not about the row that comes back. A tyre pressure stored as the number 30
 * took down the sessions list on `.trim()`, and a setup blob stored as JSON
 * `null` took down the detail page, compare, copy and the setup view on
 * `.front`. Every reader re-deciding what a stored setup is was how that
 * happened, so none of them does any more: a row read from the database goes
 * through `readStoredSession` and what comes out honours its type.
 *
 * Three rules, all the owner's (2026-09-30), and existing rows are left as they
 * are - the reader handles them, there is no data migration:
 *
 * - **A setup value** follows `storedLeafText`: text is shown as typed, a finite
 *   number as the text it prints as (30 reads `30`), and anything else - a
 *   boolean, a composite, a non-finite number, a missing key - is not logged.
 *   This is the rule the AI path already applied, and it now reads it from here.
 * - **A missing or empty setup blob** is a session with every setup field not
 *   logged. The rest of the session - track, date, laps - reads as usual.
 * - **A choice** (tyre condition, adjuster direction) is one of its own options
 *   or not logged (`null`). A default is not an answer (`lib/session-answers.ts`),
 *   so an unreadable choice is never filled in with one.
 *
 * It never throws, whatever the row holds.
 *
 * The save side is out of scope and unchanged: `lib/sessions/create.ts` and
 * `lib/sessions/parse-create-request.ts` keep their own shapes, and moving the
 * phone's save check onto `SETUP_FIELDS` is later work.
 */

/**
 * The leaf rule: the text of one stored setup value, `''` when there is none.
 *
 * `''` is what "not logged" has always been in these columns - the form saves an
 * untouched box as the empty string - so every reader that already treated a
 * blank as unlogged treats an unreadable value the same way. Text is returned as
 * stored, untrimmed, so a well-formed row reads byte for byte as it did.
 */
export function storedLeafText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return '';
}

/** A setup module, which is every `SessionModuleKey` but notes. */
export type SetupModuleKey = Exclude<SessionModuleKey, 'notes'>;

/**
 * What a setup view reads. A `Session` satisfies it, and so does
 * `baselineToComparableSession` over a stored baseline.
 */
export interface SetupSnapshot {
  tires: Tires;
  suspension: Suspension;
  alignment: Alignment | null;
  extra_modules?: ExtraModules | null;
  notes: string | null;
}

/**
 * One field of a logged setup.
 *
 * `value` is typed by the rider and follows the leaf rule. `choice` is picked
 * from fixed options and is `null` when not logged; the two are kept apart
 * because "has this module anything logged?" counts only typed values - an
 * adjuster direction on its own is how the numbers are counted, not a setting.
 */
export interface SetupField {
  /** Stable dotted path into the row, such as `tires.front.pressure`. */
  id: string;
  module: SetupModuleKey;
  kind: 'value' | 'choice';
  /** Title case, as the setup view prints it: `Front Pressure`. */
  label: string;
  read: (setup: SetupSnapshot) => string | null;
}

// The leaf lists. Each is typed against its container so a field added to a
// setup type does not compile until it is named here, and the order is the
// order every screen lists them in.
const TIRE_END_LEAVES = {
  brand: 'Brand',
  compound: 'Compound',
  pressure: 'Pressure',
} as const satisfies Record<Exclude<keyof TireEnd, 'hot_pressure'>, string>;

const SUSPENSION_END_VALUES = {
  preload: 'Preload',
  compression: 'Compression',
  rebound: 'Rebound',
} as const satisfies Record<Exclude<keyof SuspensionEnd, 'direction'>, string>;

const ALIGNMENT_LEAVES = {
  front_camber: 'Front Camber',
  rear_camber: 'Rear Camber',
  front_toe: 'Front Toe',
  rear_toe: 'Rear Toe',
  caster: 'Caster',
} as const satisfies Record<keyof Alignment, string>;

const GEOMETRY_LEAVES = {
  sag_front: 'Front Sag',
  sag_rear: 'Rear Sag',
  fork_height: 'Fork Height',
  rear_ride_height: 'Rear Ride Height',
  notes: 'Notes',
} as const satisfies Record<keyof GeometryModule, string>;

const DRIVETRAIN_LEAVES = {
  front_sprocket: 'Front Sprocket',
  rear_sprocket: 'Rear Sprocket',
  chain_length: 'Chain Length',
  notes: 'Notes',
} as const satisfies Record<keyof DrivetrainModule, string>;

const AERO_LEAVES = {
  wing_angle: 'Wing Angle',
  splitter_setting: 'Splitter Setting',
  rake: 'Rake',
  notes: 'Notes',
} as const satisfies Record<keyof AeroModule, string>;

const EXTRA_MODULE_LEAVES = {
  geometry: GEOMETRY_LEAVES,
  drivetrain: DRIVETRAIN_LEAVES,
  aero: AERO_LEAVES,
} as const satisfies Record<keyof ExtraModules, Record<string, string>>;

const TIRE_CONDITIONS: readonly TireCondition[] = ['new', 'scrubbed', 'used', 'worn'];
const SUSPENSION_DIRECTIONS: readonly SuspensionDirection[] = ['in', 'out'];
const MODULE_KEYS: readonly SessionModuleKey[] = [
  'tires',
  'suspension',
  'alignment',
  'geometry',
  'drivetrain',
  'aero',
  'notes',
];

const ENDS = [
  ['front', 'Front'],
  ['rear', 'Rear'],
] as const;

function keysOf<T extends object>(record: T): (keyof T & string)[] {
  return Object.keys(record) as (keyof T & string)[];
}

function buildSetupFields(): SetupField[] {
  const fields: SetupField[] = [
    { id: 'tires.condition', module: 'tires', kind: 'choice', label: 'Condition', read: (s) => s.tires.condition },
  ];

  for (const [end, endLabel] of ENDS) {
    for (const key of keysOf(TIRE_END_LEAVES)) {
      fields.push({
        id: `tires.${end}.${key}`,
        module: 'tires',
        kind: 'value',
        label: `${endLabel} ${TIRE_END_LEAVES[key]}`,
        read: (s) => s.tires[end][key],
      });
    }
  }

  for (const [end, endLabel] of ENDS) {
    fields.push({
      id: `suspension.${end}.direction`,
      module: 'suspension',
      kind: 'choice',
      label: `${endLabel} Direction`,
      read: (s) => s.suspension[end].direction,
    });
    for (const key of keysOf(SUSPENSION_END_VALUES)) {
      fields.push({
        id: `suspension.${end}.${key}`,
        module: 'suspension',
        kind: 'value',
        label: `${endLabel} ${SUSPENSION_END_VALUES[key]}`,
        read: (s) => s.suspension[end][key],
      });
    }
  }

  for (const key of keysOf(ALIGNMENT_LEAVES)) {
    fields.push({
      id: `alignment.${key}`,
      module: 'alignment',
      kind: 'value',
      label: ALIGNMENT_LEAVES[key],
      read: (s) => s.alignment?.[key] ?? '',
    });
  }

  for (const setupModule of keysOf(EXTRA_MODULE_LEAVES)) {
    const leaves: Record<string, string> = EXTRA_MODULE_LEAVES[setupModule];
    for (const key of Object.keys(leaves)) {
      fields.push({
        id: `extra_modules.${setupModule}.${key}`,
        module: setupModule,
        kind: 'value',
        label: leaves[key],
        read: (s) => (s.extra_modules?.[setupModule] as Record<string, string | undefined> | undefined)?.[key] ?? '',
      });
    }
  }

  return fields;
}

/**
 * The master field list: every setup field a session can log, in the order the
 * screens list them. The setup view, both compares and the "has this module
 * anything logged?" checks are built from it rather than restating it. The
 * export keeps its own column names, since those are a file format riders have
 * already downloaded.
 */
export const SETUP_FIELDS: readonly SetupField[] = buildSetupFields();

/**
 * The field's label in sentence case, `Front pressure`, as the compare screen
 * prints it. Those labels are also stored: a `session_changes` row records the
 * label of the row that changed, so this spelling is data and must not move.
 */
export function setupFieldSentenceLabel(field: SetupField): string {
  const [first, ...rest] = field.label.split(' ');
  return [first, ...rest.map((word) => word.toLowerCase())].join(' ');
}

/** The group a field is listed under, as a title: `Tires`, `Geometry`. */
export const SETUP_MODULE_TITLES: Record<SetupModuleKey, string> = {
  tires: 'Tires',
  suspension: 'Suspension',
  alignment: 'Alignment',
  geometry: 'Geometry',
  drivetrain: 'Drivetrain',
  aero: 'Aero',
};

export const SETUP_MODULE_KEYS: readonly SetupModuleKey[] = [
  'tires',
  'suspension',
  'alignment',
  'geometry',
  'drivetrain',
  'aero',
];

export function setupFieldsOf(setupModule: SetupModuleKey): SetupField[] {
  return SETUP_FIELDS.filter((field) => field.module === setupModule);
}

/** True when any typed value in the module is logged. Choices do not count. */
export function hasLoggedSetupValues(setup: SetupSnapshot, setupModule: SetupModuleKey): boolean {
  return setupFieldsOf(setupModule).some((field) => field.kind === 'value' && Boolean(field.read(setup)?.trim()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readChoice<T extends string>(options: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : null;
}

function readTireEnd(value: unknown): TireEnd {
  const source = isRecord(value) ? value : {};
  const end: TireEnd = {
    brand: storedLeafText(source.brand),
    compound: storedLeafText(source.compound),
    pressure: storedLeafText(source.pressure),
  };
  // A reading of the session after it ran, and absent on every session that has
  // none - so it is only carried when the row carries it.
  if ('hot_pressure' in source) end.hot_pressure = storedLeafText(source.hot_pressure);
  return end;
}

function readTires(value: unknown): Tires {
  const source = isRecord(value) ? value : {};
  return {
    front: readTireEnd(source.front),
    rear: readTireEnd(source.rear),
    condition: readChoice(TIRE_CONDITIONS, source.condition),
  };
}

function readSuspensionEnd(value: unknown): SuspensionEnd {
  const source = isRecord(value) ? value : {};
  return {
    preload: storedLeafText(source.preload),
    compression: storedLeafText(source.compression),
    rebound: storedLeafText(source.rebound),
    direction: readChoice(SUSPENSION_DIRECTIONS, source.direction),
  };
}

function readSuspension(value: unknown): Suspension {
  const source = isRecord(value) ? value : {};
  return { front: readSuspensionEnd(source.front), rear: readSuspensionEnd(source.rear) };
}

function readAlignment(value: unknown): Alignment | null {
  if (!isRecord(value)) return null;
  return {
    front_camber: storedLeafText(value.front_camber),
    rear_camber: storedLeafText(value.rear_camber),
    front_toe: storedLeafText(value.front_toe),
    rear_toe: storedLeafText(value.rear_toe),
    caster: storedLeafText(value.caster),
  };
}

/**
 * An advanced module keeps only the fields the row actually has, because an
 * absent field and a blank one read the same and the form spreads the module
 * over its own blanks (`copyLastSessionSetup`). A key the list does not name is
 * dropped rather than carried into that spread.
 */
function readModule(value: unknown, leaves: Record<string, string>): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const fields: Record<string, string> = {};
  for (const key of Object.keys(leaves)) {
    if (key in value) fields[key] = storedLeafText(value[key]);
  }
  return fields;
}

function readExtraModules(value: unknown): ExtraModules | null {
  if (!isRecord(value)) return null;
  const extra: ExtraModules = {};
  const geometry = readModule(value.geometry, GEOMETRY_LEAVES);
  const drivetrain = readModule(value.drivetrain, DRIVETRAIN_LEAVES);
  const aero = readModule(value.aero, AERO_LEAVES);
  if (geometry) extra.geometry = geometry;
  if (drivetrain) extra.drivetrain = drivetrain;
  if (aero) extra.aero = aero;
  return extra;
}

/**
 * Only the switches that are booleans survive. A module the object does not
 * mention is left for `sanitizeEnabledModules` to default for the vehicle, which
 * is what it already did for a legacy `{}` - so this object can be partial, and
 * its every reader goes through that function rather than indexing it.
 */
function readEnabledModules(value: unknown): SessionEnabledModules | null {
  if (!isRecord(value)) return null;
  const modules: Partial<SessionEnabledModules> = {};
  for (const key of MODULE_KEYS) {
    const flag = value[key];
    if (typeof flag === 'boolean') modules[key] = flag;
  }
  return modules as SessionEnabledModules;
}

/**
 * A setup read out of any stored blob. Shared by sessions and the baselines
 * copied from them, which store the same five columns.
 */
export function readStoredSetup(row: {
  tires?: unknown;
  suspension?: unknown;
  alignment?: unknown;
  enabled_modules?: unknown;
  extra_modules?: unknown;
}): Pick<Session, 'tires' | 'suspension' | 'alignment' | 'enabled_modules' | 'extra_modules'> {
  return {
    tires: readTires(row.tires),
    suspension: readSuspension(row.suspension),
    alignment: readAlignment(row.alignment),
    enabled_modules: readEnabledModules(row.enabled_modules),
    extra_modules: readExtraModules(row.extra_modules),
  };
}

/**
 * A `sessions` row as a `Session` whose setup honours its type. Every other
 * column is a typed SQL column and passes through as it is.
 */
export function readStoredSession(row: unknown): Session {
  const source = isRecord(row) ? row : {};
  return { ...(source as unknown as Session), ...readStoredSetup(source) };
}

export function readStoredSessions(rows: readonly unknown[] | null | undefined): Session[] {
  return (rows ?? []).map(readStoredSession);
}
