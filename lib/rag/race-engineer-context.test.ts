import { describe, expect, it } from 'vitest';
import { selectSimilarSessions } from '@/lib/rag/race-engineer-context';
import type { Session, SessionEnvironment } from '@/types';

const baseSession: Session = {
  id: 'current',
  user_id: 'user-1',
  vehicle_id: 'vehicle-1',
  track_id: 'track-1',
  track_name: 'Road America',
  date: '2026-04-22',
  start_time: '11:00:00',
  session_number: 2,
  conditions: 'sunny',
  tires: {
    front: { brand: 'Pirelli', compound: 'SC2', pressure: '31' },
    rear: { brand: 'Pirelli', compound: 'SC1', pressure: '25' },
    condition: 'scrubbed',
  },
  suspension: {
    front: { preload: '4', compression: '10', rebound: '8', direction: 'out' },
    rear: { preload: '6', compression: '12', rebound: '10', direction: 'out' },
  },
  alignment: null,
  enabled_modules: null,
  extra_modules: null,
  notes: 'Front pushed mid-corner.',
  created_at: '2026-04-22T11:00:00Z',
  updated_at: '2026-04-22T11:00:00Z',
};

function environment(sessionId: string, ambient: number): SessionEnvironment {
  return {
    id: `env-${sessionId}`,
    user_id: 'user-1',
    session_id: sessionId,
    ambient_temperature_c: ambient,
    track_temperature_c: null,
    humidity_percent: null,
    weather_condition: null,
    surface_condition: null,
    source: 'manual',
    created_at: '2026-04-22T11:00:00Z',
    updated_at: '2026-04-22T11:00:00Z',
  };
}

describe('selectSimilarSessions', () => {
  it('ranks same-track, similar-pressure sessions first', () => {
    const sameTrack = {
      ...baseSession,
      id: 'same-track',
      date: '2026-04-21',
      tires: {
        ...baseSession.tires,
        front: { ...baseSession.tires.front, pressure: '31.2' },
        rear: { ...baseSession.tires.rear, pressure: '25.4' },
      },
    };
    const differentTrack = {
      ...baseSession,
      id: 'different-track',
      track_id: 'track-2',
      track_name: 'Barber',
      date: '2026-04-20',
      tires: {
        ...baseSession.tires,
        front: { ...baseSession.tires.front, pressure: '35' },
        rear: { ...baseSession.tires.rear, pressure: '29' },
      },
    };

    const result = selectSimilarSessions({
      current: baseSession,
      candidates: [differentTrack, sameTrack],
      environments: [
        environment(baseSession.id, 26),
        environment(sameTrack.id, 28),
        environment(differentTrack.id, 15),
      ],
    });

    expect(result[0].session.id).toBe('same-track');
    expect(result[0].reasons).toContain('same track');
    expect(result[0].reasons).toContain('similar ambient temperature');
  });
});
