import { describe, expect, it } from 'vitest';
import {
  getDemoLatestSessionsByVehicle,
  getDemoPreviousSession,
  getDemoSession,
  getDemoSessionChanges,
  getDemoSessionCount,
  getDemoSessionEnvironment,
  getDemoSessionEnvironments,
  getDemoSessions,
  getDemoTelemetrySummaries,
  getDemoTracks,
  getDemoVehicleBaseline,
  getDemoVehicleBaselines,
  getDemoVehicles,
} from '@/lib/demo/data';
import { computeSetupChanges } from '@/lib/session-changes';

describe('demo data', () => {
  it('returns the sample garage, tracks, and session count', () => {
    expect(getDemoVehicles()).toHaveLength(1);
    expect(getDemoVehicles()[0]?.nickname).toBe('R6 Track Bike');
    expect(getDemoTracks()).toHaveLength(3);
    expect(getDemoSessionCount()).toBe(4);
  });

  it('sorts demo sessions newest first and supports limit', () => {
    const sessions = getDemoSessions();

    expect(sessions.map((session) => session.id)).toEqual([
      'demo-session-4',
      'demo-session-3',
      'demo-session-2',
      'demo-session-1',
    ]);
    expect(getDemoSessions(undefined, 2).map((session) => session.id)).toEqual([
      'demo-session-4',
      'demo-session-3',
    ]);
  });

  it('finds the previous demo session for the same vehicle', () => {
    const current = getDemoSession('demo-session-3');

    expect(current).not.toBeNull();
    expect(getDemoPreviousSession(current!)?.id).toBe('demo-session-2');
  });

  it('returns latest sessions by vehicle', () => {
    expect(getDemoLatestSessionsByVehicle()['demo-r6']?.id).toBe('demo-session-4');
  });

  it('returns demo environments by one id or many ids', () => {
    expect(getDemoSessionEnvironment('demo-session-2')?.track_temperature_c).toBe(34);
    expect(getDemoSessionEnvironments(['demo-session-1', 'missing'])).toHaveLength(1);
  });

  it('returns demo telemetry summaries for requested sessions', () => {
    const summaries = getDemoTelemetrySummaries(['demo-session-4', 'demo-session-3']);

    expect(summaries).toHaveLength(2);
    expect(summaries.map((summary) => summary.session_id)).toEqual(['demo-session-4', 'demo-session-3']);
    expect(summaries[0]?.metrics.best_lap_ms).toBe(103640);
  });

  it('returns the demo vehicle baseline for the R6', () => {
    const baseline = getDemoVehicleBaseline('demo-r6');

    expect(baseline?.vehicle_id).toBe('demo-r6');
    expect(baseline?.source_session_id).toBe('demo-session-3');
    expect(baseline?.source_track_name).toBe('MSR Cresson 1.7');
  });

  it('filters demo baselines by vehicle ids', () => {
    expect(getDemoVehicleBaselines(['demo-r6', 'missing']).map((baseline) => baseline.vehicle_id)).toEqual([
      'demo-r6',
    ]);
  });

  it('returns no demo baseline for missing vehicle ids', () => {
    expect(getDemoVehicleBaseline('missing')).toBeNull();
    expect(getDemoVehicleBaselines(['missing'])).toEqual([]);
  });

  it('returns no demo telemetry summaries for missing ids', () => {
    expect(getDemoTelemetrySummaries(['missing'])).toEqual([]);
  });

  it('builds demo change records from the same diff engine as the write path', () => {
    const session4 = getDemoSession('demo-session-4')!;
    const session3 = getDemoSession('demo-session-3')!;
    const baseline = getDemoVehicleBaseline('demo-r6')!;

    const records = getDemoSessionChanges('demo-session-4');

    expect(records.map((record) => record.reference_kind)).toEqual(['previous', 'baseline']);

    const previousRecord = records.find((record) => record.reference_kind === 'previous')!;
    const baselineRecord = records.find((record) => record.reference_kind === 'baseline')!;

    expect(previousRecord.changes).toEqual(computeSetupChanges(session4, session3, 'motorcycle'));
    expect(previousRecord.changes.length).toBeGreaterThan(0);
    expect(baselineRecord.reference_session_id).toBe(baseline.source_session_id);
  });

  it('returns only the previous reference for the baseline-source session', () => {
    expect(getDemoSessionChanges('demo-session-3').map((record) => record.reference_kind)).toEqual(['previous']);
  });

  it('returns no demo change records for unknown ids', () => {
    expect(getDemoSessionChanges('missing')).toEqual([]);
  });

  it('clones demo change records so callers cannot mutate shared fixtures', () => {
    const originalLength = getDemoSessionChanges('demo-session-4')[0]!.changes.length;
    const mutable = getDemoSessionChanges('demo-session-4');

    mutable[0]!.reference_label = 'Mutated';
    mutable[0]!.changes.push({ group: 'x', label: 'y', from: 'a', to: 'b' });

    const fresh = getDemoSessionChanges('demo-session-4');
    expect(fresh[0]?.reference_label).not.toBe('Mutated');
    expect(fresh[0]?.changes).toHaveLength(originalLength);
  });

  it('returns null for unknown ids', () => {
    expect(getDemoSession('missing')).toBeNull();
    expect(getDemoSessionEnvironment('missing')).toBeNull();
  });

  it('returns cloned demo data so callers cannot mutate shared fixtures', () => {
    const vehicle = getDemoVehicles()[0];
    const session = getDemoSession('demo-session-1');
    const environment = getDemoSessionEnvironment('demo-session-1');
    const telemetry = getDemoTelemetrySummaries(['demo-session-1'])[0];
    const baseline = getDemoVehicleBaseline('demo-r6');

    vehicle!.nickname = 'Mutated';
    session!.notes = 'Mutated notes';
    environment!.weather_condition = 'Mutated weather';
    telemetry!.metrics.best_lap_ms = 1;
    baseline!.tires.front.pressure = 'Mutated pressure';

    expect(getDemoVehicles()[0]?.nickname).toBe('R6 Track Bike');
    expect(getDemoSession('demo-session-1')?.notes).toContain('Neutral baseline');
    expect(getDemoSessionEnvironment('demo-session-1')?.weather_condition).toBe('Clear morning');
    expect(getDemoTelemetrySummaries(['demo-session-1'])[0]?.metrics.best_lap_ms).toBe(104740);
    expect(getDemoVehicleBaseline('demo-r6')?.tires.front.pressure).toBe('33 psi hot');
  });
});
