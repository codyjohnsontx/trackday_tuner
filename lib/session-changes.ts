import { baselineSourceLabel } from '@/lib/baseline-format';
import { buildSetupCompareRows } from '@/lib/session-compare';
import type {
  Session,
  SessionChange,
  SessionChangeEntry,
  SessionChangeReferenceKind,
  SessionEnabledModules,
  VehicleBaseline,
  VehicleType,
} from '@/types';

// Only physical setup groups are tracked. Session info + Environment are context,
// not rider changes, and free-text "Notes" churn every session and destroy signal.
export const SETUP_CHANGE_GROUPS: readonly string[] = [
  'Tires',
  'Suspension',
  'Alignment',
  'Geometry',
  'Drivetrain',
  'Aero',
];

export interface SessionChangeSet {
  referenceKind: SessionChangeReferenceKind;
  referenceLabel: string;
  entries: SessionChangeEntry[];
  persisted: boolean;
}

/**
 * Diff the current session's setup against a reference session using the shared
 * compare engine, keeping only changed rows in trackable setup groups. The module
 * "Notes" labels are dropped because free text churns every session.
 */
export function computeSetupChanges(
  current: Session,
  reference: Session,
  vehicleType: VehicleType,
): SessionChangeEntry[] {
  return buildSetupCompareRows(current, reference, undefined, undefined, vehicleType)
    .filter((row) => row.changed && SETUP_CHANGE_GROUPS.includes(row.group) && row.label !== 'Notes')
    .map((row) => ({
      group: row.group,
      label: row.label,
      from: row.baseline,
      to: row.current,
    }));
}

/**
 * Adapt a stored baseline snapshot into a Session shape so it can flow through the
 * same diff engine. Legacy `{}` enabled_modules snapshots pass through as null so
 * `resolveSessionEnabledModules` can infer modules from the stored values.
 */
export function baselineToComparableSession(baseline: VehicleBaseline): Session {
  const enabledModules =
    baseline.enabled_modules && Object.keys(baseline.enabled_modules).length > 0
      ? (baseline.enabled_modules as SessionEnabledModules)
      : null;

  return {
    id: baseline.source_session_id ?? baseline.id,
    user_id: baseline.user_id,
    vehicle_id: baseline.vehicle_id,
    track_id: baseline.source_track_id,
    track_name: baseline.source_track_name,
    date: baseline.source_date,
    start_time: baseline.source_start_time,
    session_number: baseline.source_session_number,
    conditions: baseline.source_conditions,
    tires: baseline.tires,
    suspension: baseline.suspension,
    alignment: baseline.alignment,
    enabled_modules: enabledModules,
    extra_modules: baseline.extra_modules,
    notes: baseline.notes,
    created_at: baseline.created_at,
    updated_at: baseline.updated_at,
  };
}

export function sessionReferenceLabel(session: Session): string {
  return baselineSourceLabel({
    source_track_name: session.track_name,
    source_date: session.date,
    source_session_number: session.session_number,
  });
}

export function baselineReferenceLabel(baseline: VehicleBaseline): string {
  return baselineSourceLabel(baseline);
}

/** Map persisted change records into display view models. */
export function toChangeSets(records: SessionChange[]): SessionChangeSet[] {
  return records.map((record) => ({
    referenceKind: record.reference_kind,
    referenceLabel: record.reference_label,
    entries: record.changes,
    persisted: true,
  }));
}

/**
 * Derive change sets on the fly for sessions that predate persisted records. The
 * baseline set is skipped when the session is itself the baseline source (a session
 * cannot meaningfully be compared to a snapshot of itself).
 */
export function deriveChangeSets(
  session: Session,
  previousSession: Session | null,
  baseline: VehicleBaseline | null,
  vehicleType: VehicleType,
): SessionChangeSet[] {
  const sets: SessionChangeSet[] = [];

  if (previousSession) {
    sets.push({
      referenceKind: 'previous',
      referenceLabel: sessionReferenceLabel(previousSession),
      entries: computeSetupChanges(session, previousSession, vehicleType),
      persisted: false,
    });
  }

  if (baseline && baseline.source_session_id !== session.id) {
    sets.push({
      referenceKind: 'baseline',
      referenceLabel: baselineReferenceLabel(baseline),
      entries: computeSetupChanges(session, baselineToComparableSession(baseline), vehicleType),
      persisted: false,
    });
  }

  return sets;
}
