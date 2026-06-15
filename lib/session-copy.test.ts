import { describe, expect, it } from 'vitest';
import { copyLastSessionSetup } from '@/lib/session-copy';
import type { Session } from '@/types';

const previous: Session = {
  id: 'session-1',
  user_id: 'user-1',
  vehicle_id: 'bike-1',
  track_id: 'track-1',
  track_name: 'Road America',
  date: '2026-05-01',
  start_time: '09:30:00',
  session_number: 3,
  conditions: 'overcast',
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
  enabled_modules: {
    tires: true,
    suspension: true,
    alignment: false,
    geometry: true,
    drivetrain: true,
    aero: false,
    notes: true,
  },
  extra_modules: {
    geometry: { sag_front: '35', sag_rear: '30', fork_height: '+2', rear_ride_height: '+1', notes: 'good' },
    drivetrain: { front_sprocket: '15', rear_sprocket: '45', chain_length: '118', notes: 'baseline' },
  },
  notes: 'Do not copy this note.',
  created_at: '2026-05-01T09:00:00Z',
  updated_at: '2026-05-01T09:00:00Z',
};

describe('copyLastSessionSetup', () => {
  it('copies setup fields and track without copying session identity or notes fields', () => {
    const copied = copyLastSessionSetup(previous, 'motorcycle');

    expect(copied.trackId).toBe('track-1');
    expect(copied.trackQuery).toBe('Road America');
    expect(copied.conditions).toBe('overcast');
    expect(copied.frontTire.pressure).toBe('31');
    expect(copied.rearSusp.rebound).toBe('10');
    expect(copied.geometry.sag_front).toBe('35');
    expect(copied.drivetrain.front_sprocket).toBe('15');
    expect(copied).not.toHaveProperty('date');
    expect(copied).not.toHaveProperty('startTime');
    expect(copied).not.toHaveProperty('sessionNumber');
    expect(copied).not.toHaveProperty('notes');
  });
});
