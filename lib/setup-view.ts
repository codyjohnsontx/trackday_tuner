import type {
  Alignment,
  ExtraModules,
  SessionEnabledModules,
  SessionModuleKey,
  Suspension,
  Tires,
} from '@/types';

/**
 * Turning a stored setup into label/value rows.
 *
 * The session detail page owned this as ~110 lines of inline JSX and was the
 * only screen in the app that could show a setup at all - which is why a
 * `vehicle_baselines` row, a full known-good snapshot of tires, suspension,
 * alignment, extra modules and notes, rendered nowhere but as the track/date
 * label of the session it was copied from. A baseline needs exactly the same
 * rows, so the rule lives here rather than being copied.
 *
 * The rows this produces are the rows the session detail page already showed,
 * in the order it showed them.
 */

export interface SetupRow {
  label: string;
  value: string | null;
}

export interface SetupGroup {
  key: SessionModuleKey;
  title: string;
  rows: SetupRow[];
}

export interface SetupView {
  groups: SetupGroup[];
  /** Rendered as prose rather than a row, so it is not a group. */
  notes: string | null;
}

/**
 * The subset of a session a setup view reads. A `Session` satisfies it, and so
 * does `baselineToComparableSession` over a stored baseline - which is the point.
 */
export interface SetupSnapshot {
  tires: Tires;
  suspension: Suspension;
  alignment: Alignment | null;
  extra_modules?: ExtraModules | null;
  notes: string | null;
}

function hasValue(value: string | null | undefined): value is string {
  return Boolean(value && value.trim());
}

function directionLabel(direction: string): string {
  return direction === 'in' ? 'Clicks in from open' : 'Clicks out from closed';
}

function tireRows(tires: Tires): SetupRow[] {
  return [
    { label: 'Condition', value: tires.condition },
    { label: 'Front Brand', value: tires.front.brand },
    { label: 'Front Compound', value: tires.front.compound },
    { label: 'Front Pressure', value: tires.front.pressure },
    { label: 'Rear Brand', value: tires.rear.brand },
    { label: 'Rear Compound', value: tires.rear.compound },
    { label: 'Rear Pressure', value: tires.rear.pressure },
  ];
}

function suspensionRows(suspension: Suspension): SetupRow[] {
  // Both ends are almost always counted the same way, so one row says it once.
  // When they disagree, each end states its own or the numbers below are ambiguous.
  const shared =
    suspension.front.direction === suspension.rear.direction ? suspension.front.direction : null;

  const rows: SetupRow[] = [];
  if (shared) {
    rows.push({ label: 'Direction', value: directionLabel(shared) });
  } else {
    rows.push({ label: 'Front direction', value: directionLabel(suspension.front.direction) });
  }

  rows.push(
    { label: 'Front Preload', value: suspension.front.preload },
    { label: 'Front Compression', value: suspension.front.compression },
    { label: 'Front Rebound', value: suspension.front.rebound },
  );

  if (!shared) {
    rows.push({ label: 'Rear direction', value: directionLabel(suspension.rear.direction) });
  }

  rows.push(
    { label: 'Rear Preload', value: suspension.rear.preload },
    { label: 'Rear Compression', value: suspension.rear.compression },
    { label: 'Rear Rebound', value: suspension.rear.rebound },
  );

  return rows;
}

function alignmentRows(alignment: Alignment): SetupRow[] {
  return [
    { label: 'Front Camber', value: alignment.front_camber },
    { label: 'Rear Camber', value: alignment.rear_camber },
    { label: 'Front Toe', value: alignment.front_toe },
    { label: 'Rear Toe', value: alignment.rear_toe },
    { label: 'Caster', value: alignment.caster },
  ];
}

/**
 * The advanced modules render only the fields that carry a value. Tires,
 * suspension and alignment are the core of a setup and print an em dash for a
 * blank, but a bike with nothing logged for rear ride height should not carry
 * an empty row for it.
 */
function definedRows(entries: [string, string | undefined][]): SetupRow[] {
  return entries
    .filter(([, value]) => hasValue(value))
    .map(([label, value]) => ({ label, value: value as string }));
}

export function buildSetupView(setup: SetupSnapshot, enabled: SessionEnabledModules): SetupView {
  const extra = setup.extra_modules ?? null;
  const groups: SetupGroup[] = [];

  if (enabled.tires) {
    groups.push({ key: 'tires', title: 'Tires', rows: tireRows(setup.tires) });
  }

  if (enabled.suspension) {
    groups.push({ key: 'suspension', title: 'Suspension', rows: suspensionRows(setup.suspension) });
  }

  if (enabled.alignment && setup.alignment !== null) {
    groups.push({ key: 'alignment', title: 'Alignment', rows: alignmentRows(setup.alignment) });
  }

  if (enabled.geometry && extra?.geometry) {
    groups.push({
      key: 'geometry',
      title: 'Geometry',
      rows: definedRows([
        ['Front Sag', extra.geometry.sag_front],
        ['Rear Sag', extra.geometry.sag_rear],
        ['Fork Height', extra.geometry.fork_height],
        ['Rear Ride Height', extra.geometry.rear_ride_height],
        ['Notes', extra.geometry.notes],
      ]),
    });
  }

  if (enabled.drivetrain && extra?.drivetrain) {
    groups.push({
      key: 'drivetrain',
      title: 'Drivetrain',
      rows: definedRows([
        ['Front Sprocket', extra.drivetrain.front_sprocket],
        ['Rear Sprocket', extra.drivetrain.rear_sprocket],
        ['Chain Length', extra.drivetrain.chain_length],
        ['Notes', extra.drivetrain.notes],
      ]),
    });
  }

  if (enabled.aero && extra?.aero) {
    groups.push({
      key: 'aero',
      title: 'Aero',
      rows: definedRows([
        ['Wing Angle', extra.aero.wing_angle],
        ['Splitter Setting', extra.aero.splitter_setting],
        ['Rake', extra.aero.rake],
        ['Notes', extra.aero.notes],
      ]),
    });
  }

  return {
    groups,
    notes: enabled.notes && hasValue(setup.notes) ? setup.notes : null,
  };
}

/** True when there is nothing at all to render, so a caller can show its own empty state. */
export function isSetupViewEmpty(view: SetupView): boolean {
  return view.notes === null && view.groups.every((group) => group.rows.length === 0);
}
