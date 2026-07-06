import { describe, expect, it } from 'vitest';
import {
  SETUP_CHANGE_GROUPS,
  baselineReferenceLabel,
  baselineToComparableSession,
  computeSetupChanges,
  deriveChangeSets,
  sessionReferenceLabel,
  toChangeSets,
} from '@/lib/session-changes';
import type { Session, SessionChange, SessionEnabledModules, VehicleBaseline } from '@/types';

const allMotorcycleModules: SessionEnabledModules = {
  tires: true,
  suspension: true,
  alignment: false,
  geometry: true,
  drivetrain: true,
  aero: false,
  notes: true,
};

const baseSession: Session = {
  id: 'session-current',
  user_id: 'user-1',
  vehicle_id: 'veh-1',
  track_id: 'track-1',
  track_name: 'MSR Cresson 1.7',
  date: '2026-05-18',
  start_time: '14:20:00',
  session_number: 4,
  conditions: 'sunny',
  tires: {
    condition: 'used',
    front: { brand: 'Pirelli', compound: 'SC1', pressure: '34 psi hot' },
    rear: { brand: 'Pirelli', compound: 'SC2', pressure: '27 psi hot' },
  },
  suspension: {
    front: { preload: '5 turns', compression: '12 clicks', rebound: '10 clicks', direction: 'out' },
    rear: { preload: '8 mm', compression: '11 clicks', rebound: '12 clicks', direction: 'out' },
  },
  alignment: null,
  enabled_modules: allMotorcycleModules,
  extra_modules: {
    geometry: { sag_front: '35 mm', notes: 'stable' },
    drivetrain: { front_sprocket: '15T' },
  },
  notes: 'Current notes',
  created_at: '2026-05-18T19:45:00.000Z',
  updated_at: '2026-05-18T19:45:00.000Z',
};

function makeSession(overrides: Partial<Session>): Session {
  return { ...baseSession, ...overrides };
}

const baseBaseline: VehicleBaseline = {
  id: 'baseline-1',
  user_id: 'user-1',
  vehicle_id: 'veh-1',
  source_session_id: 'session-source',
  source_track_id: 'track-1',
  source_track_name: 'MSR Cresson 1.7',
  source_date: '2026-05-18',
  source_start_time: '11:30:00',
  source_session_number: 3,
  source_conditions: 'sunny',
  tires: baseSession.tires,
  suspension: baseSession.suspension,
  alignment: null,
  enabled_modules: allMotorcycleModules,
  extra_modules: baseSession.extra_modules,
  notes: 'Baseline notes',
  created_at: '2026-05-18T16:55:00.000Z',
  updated_at: '2026-05-18T16:55:00.000Z',
};

function makeBaseline(overrides: Partial<VehicleBaseline>): VehicleBaseline {
  return { ...baseBaseline, ...overrides };
}

describe('computeSetupChanges', () => {
  it('keeps only changed setup-group rows and drops context and notes rows', () => {
    const reference = makeSession({
      id: 'session-ref',
      conditions: 'overcast',
      tires: {
        condition: 'scrubbed',
        front: { brand: 'Pirelli', compound: 'SC1', pressure: '33 psi hot' },
        rear: { brand: 'Pirelli', compound: 'SC2', pressure: '27 psi hot' },
      },
      suspension: {
        front: { preload: '5 turns', compression: '10 clicks', rebound: '10 clicks', direction: 'out' },
        rear: { preload: '8 mm', compression: '11 clicks', rebound: '12 clicks', direction: 'out' },
      },
      extra_modules: {
        geometry: { sag_front: '35 mm', notes: 'different geometry note' },
        drivetrain: { front_sprocket: '15T' },
      },
      notes: 'Reference notes',
    });

    const entries = computeSetupChanges(baseSession, reference, 'motorcycle');
    const labels = entries.map((entry) => `${entry.group}:${entry.label}`);

    expect(entries.every((entry) => SETUP_CHANGE_GROUPS.includes(entry.group))).toBe(true);
    expect(entries.some((entry) => entry.label === 'Notes')).toBe(false);
    expect(entries.some((entry) => entry.group === 'Session info')).toBe(false);
    expect(entries.some((entry) => entry.group === 'Environment')).toBe(false);
    expect(labels).toContain('Tires:Condition');
    expect(labels).toContain('Tires:Front pressure');
    expect(labels).toContain('Suspension:Front compression');
  });

  it('maps reference value to `from` and current value to `to`', () => {
    const reference = makeSession({
      id: 'session-ref',
      tires: {
        condition: 'scrubbed',
        front: { brand: 'Pirelli', compound: 'SC1', pressure: '33 psi hot' },
        rear: { brand: 'Pirelli', compound: 'SC2', pressure: '27 psi hot' },
      },
    });

    const entries = computeSetupChanges(baseSession, reference, 'motorcycle');

    expect(entries.find((entry) => entry.label === 'Condition')).toEqual({
      group: 'Tires',
      label: 'Condition',
      from: 'scrubbed',
      to: 'used',
    });
  });

  it('returns no entries when setup is unchanged', () => {
    expect(computeSetupChanges(baseSession, makeSession({ id: 'session-ref' }), 'motorcycle')).toEqual([]);
  });

  it('emits a row when a module is enabled on only one side', () => {
    const current = makeSession({
      enabled_modules: { ...allMotorcycleModules, geometry: false, drivetrain: true },
      extra_modules: { drivetrain: { front_sprocket: '16T' } },
    });
    const reference = makeSession({
      id: 'session-ref',
      enabled_modules: { ...allMotorcycleModules, geometry: false, drivetrain: false },
      extra_modules: { drivetrain: { front_sprocket: '15T' } },
    });

    const entries = computeSetupChanges(current, reference, 'motorcycle');

    expect(entries.find((entry) => entry.group === 'Drivetrain' && entry.label === 'Front sprocket')).toEqual({
      group: 'Drivetrain',
      label: 'Front sprocket',
      from: '',
      to: '16T',
    });
  });
});

describe('baselineToComparableSession', () => {
  it('maps source fields onto session fields', () => {
    const comparable = baselineToComparableSession(baseBaseline);

    expect(comparable.track_id).toBe(baseBaseline.source_track_id);
    expect(comparable.track_name).toBe(baseBaseline.source_track_name);
    expect(comparable.date).toBe(baseBaseline.source_date);
    expect(comparable.start_time).toBe(baseBaseline.source_start_time);
    expect(comparable.session_number).toBe(baseBaseline.source_session_number);
    expect(comparable.conditions).toBe(baseBaseline.source_conditions);
    expect(comparable.tires).toEqual(baseBaseline.tires);
    expect(comparable.enabled_modules).toEqual(allMotorcycleModules);
  });

  it('passes legacy empty enabled_modules through as null for inference', () => {
    expect(baselineToComparableSession(makeBaseline({ enabled_modules: {} })).enabled_modules).toBeNull();
  });
});

describe('deriveChangeSets', () => {
  it('derives previous and baseline sets when the session is not the baseline source', () => {
    const previous = makeSession({ id: 'session-prev', session_number: 3 });
    const baseline = makeBaseline({ source_session_id: 'other-session' });

    const sets = deriveChangeSets(baseSession, previous, baseline, 'motorcycle');

    expect(sets.map((set) => set.referenceKind)).toEqual(['previous', 'baseline']);
    expect(sets.every((set) => set.persisted === false)).toBe(true);
  });

  it('skips the baseline set when the session is the baseline source', () => {
    const previous = makeSession({ id: 'session-prev' });
    const baseline = makeBaseline({ source_session_id: baseSession.id });

    const sets = deriveChangeSets(baseSession, previous, baseline, 'motorcycle');

    expect(sets.map((set) => set.referenceKind)).toEqual(['previous']);
  });

  it('derives no sets when there is no previous session or baseline', () => {
    expect(deriveChangeSets(baseSession, null, null, 'motorcycle')).toEqual([]);
  });
});

describe('reference labels', () => {
  it('formats a session reference label', () => {
    expect(
      sessionReferenceLabel(makeSession({ track_name: 'MSR Cresson 1.7', date: '2026-05-18', session_number: 4 })),
    ).toBe('MSR Cresson 1.7 · May 18, 2026 · Session 4');
  });

  it('formats a baseline reference label', () => {
    expect(
      baselineReferenceLabel(
        makeBaseline({
          source_track_name: 'Circuit of The Americas',
          source_date: '2026-05-18',
          source_session_number: 3,
        }),
      ),
    ).toBe('Circuit of The Americas · May 18, 2026 · Session 3');
  });
});

describe('toChangeSets', () => {
  it('maps persisted records into change sets marked persisted', () => {
    const record: SessionChange = {
      id: 'change-1',
      user_id: 'user-1',
      session_id: 'session-current',
      vehicle_id: 'veh-1',
      reference_kind: 'previous',
      reference_session_id: 'session-prev',
      reference_label: 'MSR Cresson 1.7 · May 18, 2026 · Session 3',
      reference_date: '2026-05-18',
      changes: [{ group: 'Tires', label: 'Front pressure', from: '33 psi hot', to: '34 psi hot' }],
      created_at: '2026-05-18T19:45:00.000Z',
      updated_at: '2026-05-18T19:45:00.000Z',
    };

    const sets = toChangeSets([record]);

    expect(sets).toEqual([
      {
        referenceKind: 'previous',
        referenceLabel: 'MSR Cresson 1.7 · May 18, 2026 · Session 3',
        entries: record.changes,
        persisted: true,
      },
    ]);
  });
});
