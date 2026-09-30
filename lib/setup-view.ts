import {
  SETUP_MODULE_TITLES,
  setupFieldSentenceLabel,
  setupFieldsOf,
  type SetupModuleKey,
  type SetupSnapshot,
} from '@/lib/stored-session';
import type { SessionEnabledModules, SessionModuleKey, SuspensionDirection } from '@/types';

export type { SetupSnapshot } from '@/lib/stored-session';

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
 * Which fields exist, in what order and under what label is `SETUP_FIELDS`
 * (`lib/stored-session.ts`); this decides only how a group is laid out.
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

function hasValue(value: string | null | undefined): value is string {
  return Boolean(value && value.trim());
}

function directionLabel(direction: SuspensionDirection | null): string | null {
  if (direction === null) return null;
  return direction === 'in' ? 'Clicks in from open' : 'Clicks out from closed';
}

/**
 * Tires, suspension and alignment are the core of a setup and print an em dash
 * for a blank.
 */
function coreRows(setup: SetupSnapshot, module: 'tires' | 'alignment'): SetupRow[] {
  return setupFieldsOf(module).map((field) => ({ label: field.label, value: field.read(setup) }));
}

function suspensionRows(setup: SetupSnapshot): SetupRow[] {
  // Both ends are almost always counted the same way, so one row says it once.
  // When they disagree, each end states its own or the numbers below are ambiguous.
  const shared = setup.suspension.front.direction === setup.suspension.rear.direction;

  const rows: SetupRow[] = [];
  for (const field of setupFieldsOf('suspension')) {
    if (field.kind === 'value') {
      rows.push({ label: field.label, value: field.read(setup) });
      continue;
    }
    const direction = field.read(setup) as SuspensionDirection | null;
    if (!shared) {
      rows.push({ label: setupFieldSentenceLabel(field), value: directionLabel(direction) });
    } else if (field.id === 'suspension.front.direction') {
      rows.push({ label: 'Direction', value: directionLabel(direction) });
    }
  }
  return rows;
}

/**
 * The advanced modules render only the fields that carry a value. A bike with
 * nothing logged for rear ride height should not carry an empty row for it.
 */
function definedRows(setup: SetupSnapshot, module: SetupModuleKey): SetupRow[] {
  return setupFieldsOf(module).flatMap((field) => {
    const value = field.read(setup);
    return hasValue(value) ? [{ label: field.label, value }] : [];
  });
}

export function buildSetupView(setup: SetupSnapshot, enabled: SessionEnabledModules): SetupView {
  const groups: SetupGroup[] = [];

  if (enabled.tires) {
    groups.push({ key: 'tires', title: SETUP_MODULE_TITLES.tires, rows: coreRows(setup, 'tires') });
  }

  if (enabled.suspension) {
    groups.push({ key: 'suspension', title: SETUP_MODULE_TITLES.suspension, rows: suspensionRows(setup) });
  }

  if (enabled.alignment && setup.alignment !== null) {
    groups.push({ key: 'alignment', title: SETUP_MODULE_TITLES.alignment, rows: coreRows(setup, 'alignment') });
  }

  for (const key of ['geometry', 'drivetrain', 'aero'] as const) {
    if (enabled[key] && setup.extra_modules?.[key]) {
      groups.push({ key, title: SETUP_MODULE_TITLES[key], rows: definedRows(setup, key) });
    }
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
