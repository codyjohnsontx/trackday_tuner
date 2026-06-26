import { describe, expect, it } from 'vitest';
import {
  getDemoLatestSessionsByVehicle,
  getDemoPreviousSession,
  getDemoSession,
  getDemoSessionCount,
  getDemoSessionEnvironment,
  getDemoSessionEnvironments,
  getDemoSessions,
  getDemoTelemetrySummaries,
  getDemoTracks,
  getDemoVehicles,
} from '@/lib/demo/data';

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

  it('returns no demo telemetry summaries for missing ids', () => {
    expect(getDemoTelemetrySummaries(['missing'])).toEqual([]);
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

    vehicle!.nickname = 'Mutated';
    session!.notes = 'Mutated notes';
    environment!.weather_condition = 'Mutated weather';
    telemetry!.metrics.best_lap_ms = 1;

    expect(getDemoVehicles()[0]?.nickname).toBe('R6 Track Bike');
    expect(getDemoSession('demo-session-1')?.notes).toContain('Neutral baseline');
    expect(getDemoSessionEnvironment('demo-session-1')?.weather_condition).toBe('Clear morning');
    expect(getDemoTelemetrySummaries(['demo-session-1'])[0]?.metrics.best_lap_ms).toBe(104740);
  });
});
