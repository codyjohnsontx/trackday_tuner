import { describe, expect, it } from 'vitest';
import { buildSessionHistorySummary, getNotesPreview } from '@/lib/session-history';
import type { Session, SessionEnvironment } from '@/types';

function session(partial: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    user_id: 'user-1',
    vehicle_id: 'vehicle-1',
    track_id: null,
    track_name: 'Road America',
    date: '2026-04-23',
    start_time: '13:15:00',
    session_number: 2,
    conditions: 'sunny',
    tires: {
      front: { brand: 'Pirelli', compound: 'SC1', pressure: '31' },
      rear: { brand: 'Pirelli', compound: 'SC0', pressure: '24' },
      condition: 'used',
    },
    suspension: {
      front: { preload: '4', compression: '10', rebound: '8', direction: 'out' },
      rear: { preload: '6', compression: '12', rebound: '10', direction: 'out' },
    },
    alignment: null,
    enabled_modules: null,
    extra_modules: null,
    notes: 'Front felt calmer on entry, but it still pushed a little mid-corner after four laps in the warmer afternoon session.',
    created_at: '2026-04-23T13:15:00Z',
    updated_at: '2026-04-23T13:15:00Z',
    ...partial,
  };
}

function environment(partial: Partial<SessionEnvironment> = {}): SessionEnvironment {
  return {
    id: 'env-1',
    user_id: 'user-1',
    session_id: 'session-1',
    ambient_temperature_c: 26,
    track_temperature_c: 38,
    humidity_percent: 48,
    weather_condition: 'Warming',
    surface_condition: 'Rubbered in',
    source: 'manual',
    created_at: '2026-04-23T13:15:00Z',
    updated_at: '2026-04-23T13:15:00Z',
    ...partial,
  };
}

describe('session-history helpers', () => {
  it('builds environment and setup rows for inline summaries', () => {
    const summary = buildSessionHistorySummary(session(), environment());
    expect(summary.conditionLabel).toBe('Sunny');
    expect(summary.timeLabel).toBe('1:15 PM');
    expect(summary.environmentRows).toEqual(
      expect.arrayContaining([
        { label: 'Ambient', value: '26 C' },
        { label: 'Track', value: '38 C' },
      ]),
    );
    expect(summary.tireRows[0]).toEqual({ label: 'Front Tire', value: '31' });
    expect(summary.suspensionRows[0].value).toContain('10');
  });

  it('truncates long note previews cleanly', () => {
    const preview = getNotesPreview(
      'This is a long note that should be truncated at a word boundary so the inline accordion summary stays tidy and does not turn into a full detail page replacement.',
    );
    expect(preview).toMatch(/\.\.\.$/);
    expect(preview?.length).toBeLessThanOrEqual(143);
  });

  it('omits notes preview when notes are blank', () => {
    expect(getNotesPreview('   ')).toBeNull();
    expect(buildSessionHistorySummary(session({ notes: '   ' }), null).notesPreview).toBeNull();
  });
});
