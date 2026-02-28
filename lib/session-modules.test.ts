import { describe, expect, it } from 'vitest';
import {
  getAvailableSessionModules,
  getDefaultEnabledModules,
  resolveSessionEnabledModules,
  sanitizeEnabledModules,
} from '@/lib/session-modules';
import type { Session } from '@/types';

const baseSession: Session = {
  id: 'session-1',
  user_id: 'user-1',
  vehicle_id: 'vehicle-1',
  track_id: null,
  track_name: 'Road America',
  date: '2026-02-28',
  start_time: '09:00:00',
  session_number: 1,
  conditions: 'sunny',
  tires: {
    front: { brand: '', compound: '', pressure: '31' },
    rear: { brand: '', compound: '', pressure: '24' },
    condition: 'used',
  },
  suspension: {
    front: { preload: '4', compression: '10', rebound: '8', direction: 'out' },
    rear: { preload: '6', compression: '12', rebound: '10', direction: 'out' },
  },
  alignment: null,
  enabled_modules: null,
  extra_modules: null,
  notes: null,
  created_at: '2026-02-28T09:00:00Z',
  updated_at: '2026-02-28T09:00:00Z',
};

describe('session modules', () => {
  it('returns vehicle-aware module availability', () => {
    expect(getAvailableSessionModules('motorcycle')).toEqual([
      'tires',
      'suspension',
      'geometry',
      'drivetrain',
      'notes',
    ]);
    expect(getAvailableSessionModules('car')).toEqual([
      'tires',
      'suspension',
      'alignment',
      'aero',
      'notes',
    ]);
  });

  it('uses basic defaults by vehicle type', () => {
    expect(getDefaultEnabledModules('motorcycle')).toEqual({
      tires: true,
      suspension: true,
      alignment: false,
      geometry: false,
      drivetrain: false,
      aero: false,
      notes: true,
    });
  });

  it('sanitizes unsupported modules when vehicle type changes', () => {
    expect(
      sanitizeEnabledModules('car', {
        tires: true,
        suspension: true,
        alignment: true,
        geometry: true,
        drivetrain: true,
        aero: true,
        notes: false,
      }),
    ).toEqual({
      tires: true,
      suspension: true,
      alignment: true,
      geometry: false,
      drivetrain: false,
      aero: true,
      notes: true,
    });
  });

  it('falls back for legacy motorcycle sessions without enabled_modules', () => {
    const resolved = resolveSessionEnabledModules(
      {
        ...baseSession,
        extra_modules: {
          geometry: { sag_front: '35' },
          drivetrain: { front_sprocket: '15' },
        },
        notes: 'Bike felt planted.',
      },
      'motorcycle',
    );

    expect(resolved.geometry).toBe(true);
    expect(resolved.drivetrain).toBe(true);
    expect(resolved.notes).toBe(true);
    expect(resolved.alignment).toBe(false);
  });

  it('prefers stored enabled_modules when present', () => {
    const resolved = resolveSessionEnabledModules(
      {
        ...baseSession,
        enabled_modules: {
          tires: false,
          suspension: true,
          alignment: false,
          geometry: false,
          drivetrain: false,
          aero: false,
          notes: true,
        },
      },
      'motorcycle',
    );

    expect(resolved.tires).toBe(false);
    expect(resolved.suspension).toBe(true);
  });
});
