import { describe, expect, it } from 'vitest';
import { baselineSourceLabel } from '@/lib/baseline-format';
import type { VehicleBaseline } from '@/types';

function makeBaseline(overrides: Partial<VehicleBaseline> = {}): VehicleBaseline {
  return {
    id: 'baseline-1',
    user_id: 'user-1',
    vehicle_id: 'vehicle-1',
    source_session_id: 'session-1',
    source_track_id: 'track-1',
    source_track_name: 'MSR Cresson',
    source_date: '2026-05-18',
    source_start_time: '10:30:00',
    source_session_number: 3,
    source_conditions: 'sunny',
    tires: {},
    suspension: {},
    alignment: null,
    enabled_modules: {},
    extra_modules: null,
    notes: null,
    created_at: '2026-05-18T14:10:00.000Z',
    updated_at: '2026-05-18T14:10:00.000Z',
    ...overrides,
  } as VehicleBaseline;
}

describe('baselineSourceLabel', () => {
  it('joins track, date, and session number', () => {
    expect(baselineSourceLabel(makeBaseline())).toBe('MSR Cresson · May 18, 2026 · Session 3');
  });

  it('falls back to Unknown Track when track name is missing', () => {
    expect(baselineSourceLabel(makeBaseline({ source_track_name: null }))).toBe(
      'Unknown Track · May 18, 2026 · Session 3',
    );
  });

  it('omits the session segment when session number is missing', () => {
    expect(baselineSourceLabel(makeBaseline({ source_session_number: null }))).toBe(
      'MSR Cresson · May 18, 2026',
    );
  });
});
