import { describe, expect, it } from 'vitest';
import {
  assignComparisonStrength,
  buildContextFlags,
  buildSessionComparisonModel,
  buildSetupCompareRows,
  extractLapMetrics,
  formatLapTime,
} from '@/lib/session-compare';
import type { Session, SessionEnvironment, TelemetrySummary } from '@/types';

const baseSession: Session = {
  id: 'session-1',
  user_id: 'user-1',
  vehicle_id: 'vehicle-1',
  track_id: 'track-1',
  track_name: 'MSR Cresson',
  date: '2026-02-24',
  start_time: '09:00:00',
  session_number: 1,
  conditions: 'sunny',
  tires: {
    condition: 'scrubbed',
    front: { brand: 'Pirelli', compound: 'SC1', pressure: '33 psi' },
    rear: { brand: 'Pirelli', compound: 'SC2', pressure: '26 psi' },
  },
  suspension: {
    front: { preload: '5 turns', compression: '12 clicks', rebound: '10 clicks', direction: 'out' },
    rear: { preload: '8 mm', compression: '11 clicks', rebound: '12 clicks', direction: 'out' },
  },
  alignment: {
    front_camber: '-3.0',
    rear_camber: '-2.0',
    front_toe: '0',
    rear_toe: '1 mm in',
    caster: '7.0',
  },
  enabled_modules: {
    tires: true,
    suspension: true,
    alignment: true,
    geometry: true,
    drivetrain: true,
    aero: true,
    notes: true,
  },
  extra_modules: {
    geometry: {
      sag_front: '35 mm',
      sag_rear: '29 mm',
      fork_height: '4 mm showing',
      rear_ride_height: 'baseline',
      notes: 'Stable geometry.',
    },
    drivetrain: {
      front_sprocket: '15T',
      rear_sprocket: '45T',
      chain_length: '116 links',
      notes: 'Known gearing.',
    },
    aero: {
      wing_angle: '2 deg',
      splitter_setting: 'low',
      rake: 'baseline',
      notes: 'Stable aero.',
    },
  },
  notes: 'Clean laps.',
  created_at: '2026-02-24T09:30:00Z',
  updated_at: '2026-02-24T09:30:00Z',
};

const baseEnvironment: SessionEnvironment = {
  id: 'env-1',
  user_id: 'user-1',
  session_id: 'session-1',
  ambient_temperature_c: 22,
  track_temperature_c: 31,
  humidity_percent: 52,
  weather_condition: 'Clear',
  surface_condition: 'Clean',
  source: 'manual',
  created_at: '2026-02-24T09:30:00Z',
  updated_at: '2026-02-24T09:30:00Z',
};

function session(overrides: Partial<Session> = {}): Session {
  return {
    ...baseSession,
    ...overrides,
    tires: { ...baseSession.tires, ...overrides.tires },
    suspension: { ...baseSession.suspension, ...overrides.suspension },
    extra_modules: overrides.extra_modules ?? baseSession.extra_modules,
  };
}

function environment(overrides: Partial<SessionEnvironment> = {}): SessionEnvironment {
  return { ...baseEnvironment, ...overrides };
}

function telemetry(metrics: TelemetrySummary['metrics']): TelemetrySummary {
  return {
    id: 'telemetry-1',
    user_id: 'user-1',
    session_id: 'session-1',
    vehicle_id: 'vehicle-1',
    source: 'test',
    summary: null,
    metrics,
    created_at: '2026-02-24T09:30:00Z',
    updated_at: '2026-02-24T09:30:00Z',
  };
}

describe('session compare helpers', () => {
  it('formats lap times correctly', () => {
    expect(formatLapTime(95432)).toBe('1:35.432');
    expect(formatLapTime(42100)).toBe('42.100');
    expect(formatLapTime(null)).toBe('—');
    expect(formatLapTime(-1)).toBe('—');
  });

  it('extracts metrics from explicit telemetry fields', () => {
    expect(
      extractLapMetrics(
        telemetry({
          best_lap_ms: 95432,
          average_lap_ms: 96120,
          lap_count: 7,
          consistency_spread_ms: 1200,
          lap_times_ms: [99000, 98000],
        }),
      ),
    ).toEqual({
      bestLapMs: 95432,
      averageLapMs: 96120,
      lapCount: 7,
      consistencySpreadMs: 1200,
    });
  });

  it('computes metrics from lap_times_ms and ignores invalid lap values', () => {
    expect(
      extractLapMetrics(
        telemetry({
          lap_times_ms: [100000, -1, Number.NaN, 98000, 102000, 0],
        }),
      ),
    ).toEqual({
      bestLapMs: 98000,
      averageLapMs: 100000,
      lapCount: 3,
      consistencySpreadMs: 4000,
    });
  });

  it('produces strong, useful, and weak comparison labels', () => {
    const current = session({ id: 'current', session_number: 2 });
    const baseline = session({ id: 'baseline' });
    const currentMetrics = extractLapMetrics(telemetry({ best_lap_ms: 95000 }));
    const baselineMetrics = extractLapMetrics(telemetry({ best_lap_ms: 96000 }));

    expect(
      assignComparisonStrength(
        { currentSession: current, baselineSession: baseline, currentEnvironment: baseEnvironment, baselineEnvironment: baseEnvironment },
        [],
      ),
    ).toBe('strong');

    const usefulFlags = buildContextFlags(
      {
        currentSession: current,
        baselineSession: session({ id: 'baseline', conditions: 'overcast' }),
        currentEnvironment: baseEnvironment,
        baselineEnvironment: baseEnvironment,
      },
      currentMetrics,
      baselineMetrics,
    );
    expect(assignComparisonStrength({ currentSession: current, baselineSession: baseline }, usefulFlags)).toBe('useful');

    const weakFlags = buildContextFlags(
      {
        currentSession: current,
        baselineSession: session({ id: 'baseline', track_id: 'track-2', track_name: 'COTA' }),
        currentEnvironment: baseEnvironment,
        baselineEnvironment: baseEnvironment,
      },
      currentMetrics,
      baselineMetrics,
    );
    expect(assignComparisonStrength({ currentSession: current, baselineSession: session({ track_id: 'track-2' }) }, weakFlags)).toBe('weak');
  });

  it('flags large ambient and track temperature deltas', () => {
    const flags = buildContextFlags(
      {
        currentSession: session({ id: 'current' }),
        baselineSession: session({ id: 'baseline' }),
        currentEnvironment: environment({ ambient_temperature_c: 30, track_temperature_c: 45 }),
        baselineEnvironment: environment({ ambient_temperature_c: 22, track_temperature_c: 31 }),
      },
      extractLapMetrics(telemetry({ best_lap_ms: 95000 })),
      extractLapMetrics(telemetry({ best_lap_ms: 96000 })),
    );

    expect(flags.map((flag) => flag.key)).toContain('ambient-temperature-delta');
    expect(flags.map((flag) => flag.key)).toContain('track-temperature-delta');
  });

  it('flags missing lap data and tire compound or condition differences', () => {
    const flags = buildContextFlags(
      {
        currentSession: session({
          id: 'current',
          tires: {
            condition: 'used',
            front: { brand: 'Pirelli', compound: 'SC2', pressure: '33 psi' },
            rear: { brand: 'Pirelli', compound: 'SC3', pressure: '26 psi' },
          },
        }),
        baselineSession: session({ id: 'baseline' }),
        currentEnvironment: baseEnvironment,
        baselineEnvironment: baseEnvironment,
      },
      extractLapMetrics(null),
      extractLapMetrics(telemetry({ best_lap_ms: 96000 })),
    );

    expect(flags.map((flag) => flag.key)).toEqual(
      expect.arrayContaining(['lap-data-missing', 'tire-condition-mismatch', 'tire-compound-mismatch']),
    );
  });

  it('builds setup deltas with changed and unchanged rows', () => {
    const rows = buildSetupCompareRows(
      session({ id: 'current', suspension: { ...baseSession.suspension, front: { ...baseSession.suspension.front, compression: '10 clicks' } } }),
      session({ id: 'baseline' }),
      baseEnvironment,
      baseEnvironment,
    );

    expect(rows.find((row) => row.group === 'Suspension' && row.label === 'Front compression')).toMatchObject({
      current: '10 clicks',
      baseline: '12 clicks',
      changed: true,
    });
    expect(rows.find((row) => row.group === 'Tires' && row.label === 'Rear compound')).toMatchObject({
      changed: false,
    });
  });

  it('generates non-causal summary language', () => {
    const model = buildSessionComparisonModel({
      currentSession: session({ id: 'current', session_number: 4 }),
      baselineSession: session({ id: 'baseline', session_number: 3 }),
      currentEnvironment: environment({ track_temperature_c: 45 }),
      baselineEnvironment: environment({ track_temperature_c: 31 }),
      currentTelemetry: telemetry({ best_lap_ms: 95000 }),
      baselineTelemetry: telemetry({ best_lap_ms: 96000 }),
    });

    expect(model.summary).toContain('comparison signal');
    expect(model.summary.toLowerCase()).not.toMatch(/caused|because of|due to/);
  });
});
