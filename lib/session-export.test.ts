import { describe, expect, it } from 'vitest';
import {
  buildSessionExportCsv,
  deriveSessionAnalytics,
  escapeCsvValue,
  flattenSessionForExport,
} from '@/lib/session-export';
import type { Session, SessionEnvironment, Vehicle } from '@/types';

const motorcycle: Vehicle = {
  id: 'bike-1',
  user_id: 'user-1',
  nickname: 'R6',
  type: 'motorcycle',
  year: 2020,
  make: 'Yamaha',
  model: 'YZF-R6',
  photo_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const car: Vehicle = {
  ...motorcycle,
  id: 'car-1',
  nickname: 'Miata',
  type: 'car',
  make: 'Mazda',
  model: 'MX-5',
};

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    user_id: 'user-1',
    vehicle_id: 'bike-1',
    track_id: 'track-1',
    track_name: 'Road America',
    date: '2026-05-01',
    start_time: '09:30:00',
    session_number: 1,
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
      geometry: { sag_front: '35', sag_rear: '30', fork_height: '+2', rear_ride_height: '+1', notes: 'stable' },
      drivetrain: { front_sprocket: '15', rear_sprocket: '45', chain_length: '118', notes: 'baseline' },
    },
    notes: 'Good drive, watch T5.',
    created_at: '2026-05-01T09:00:00Z',
    updated_at: '2026-05-01T09:00:00Z',
    ...overrides,
  };
}

function environment(overrides: Partial<SessionEnvironment> = {}): SessionEnvironment {
  return {
    id: 'env-1',
    user_id: 'user-1',
    session_id: 'session-1',
    ambient_temperature_c: 24,
    track_temperature_c: 36,
    humidity_percent: 55,
    weather_condition: 'light wind',
    surface_condition: 'rubbered in',
    source: 'manual',
    created_at: '2026-05-01T09:00:00Z',
    updated_at: '2026-05-01T09:00:00Z',
    ...overrides,
  };
}

describe('session export helpers', () => {
  it('escapes csv values', () => {
    expect(escapeCsvValue(null)).toBe('');
    expect(escapeCsvValue(24)).toBe('24');
    expect(escapeCsvValue('plain')).toBe('plain');
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvValue('line\nbreak')).toBe('"line\nbreak"');
    expect(escapeCsvValue('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(escapeCsvValue('+cmd')).toBe("'+cmd");
    expect(escapeCsvValue('-10')).toBe("'-10");
    expect(escapeCsvValue('@user')).toBe("'@user");
  });

  it('flattens motorcycle sessions with setup and environment data', () => {
    const row = flattenSessionForExport({
      session: session(),
      vehicle: motorcycle,
      environment: environment(),
    });

    expect(row.vehicle_nickname).toBe('R6');
    expect(row.vehicle_type).toBe('motorcycle');
    expect(row.sag_front).toBe('35');
    expect(row.front_sprocket).toBe('15');
    expect(row.wing_angle).toBeNull();
    expect(row.ambient_temperature_c).toBe(24);
  });

  it('flattens car sessions and leaves disabled modules empty', () => {
    const row = flattenSessionForExport({
      session: session({
        id: 'car-session',
        vehicle_id: 'car-1',
        alignment: {
          front_camber: '-2.5',
          rear_camber: '-1.8',
          front_toe: '0.1',
          rear_toe: '0.2',
          caster: '6.5',
        },
        enabled_modules: {
          tires: true,
          suspension: false,
          alignment: true,
          geometry: false,
          drivetrain: false,
          aero: true,
          notes: true,
        },
        extra_modules: {
          aero: { wing_angle: '4', splitter_setting: 'low', rake: '1.2', notes: 'more rear support' },
        },
      }),
      vehicle: car,
      environment: null,
    });

    expect(row.vehicle_type).toBe('car');
    expect(row.front_preload).toBeNull();
    expect(row.front_camber).toBe('-2.5');
    expect(row.wing_angle).toBe('4');
    expect(row.ambient_temperature_c).toBeNull();
  });

  it('builds csv with headers and escaped note values', () => {
    const csv = buildSessionExportCsv([
      {
        session: session({ notes: 'Comma, quote "ok"' }),
        vehicle: motorcycle,
        environment: null,
      },
    ]);

    expect(csv).toContain('session_id,vehicle_id,vehicle_nickname');
    expect(csv).toContain('"Comma, quote ""ok"""');
  });

  it('derives analytics for empty and mixed data', () => {
    expect(deriveSessionAnalytics([])).toMatchObject({
      totalSessions: 0,
      sessionsByVehicle: [],
      topTracks: [],
      environmentSnapshots: {
        withEnvironment: 0,
        averageAmbientTemperatureC: null,
      },
    });

    const analytics = deriveSessionAnalytics([
      { session: session({ id: 's1', date: '2026-05-01', vehicle_id: 'bike-1' }), vehicle: motorcycle, environment: environment() },
      { session: session({ id: 's2', date: '2026-05-02', vehicle_id: 'bike-1', tires: { ...session().tires, front: { ...session().tires.front, pressure: '32' } } }), vehicle: motorcycle, environment: null },
      { session: session({ id: 's3', vehicle_id: 'car-1', track_name: 'Laguna Seca' }), vehicle: car, environment: environment({ ambient_temperature_c: 26 }) },
    ]);

    expect(analytics.totalSessions).toBe(3);
    expect(analytics.sessionsByVehicle[0]).toEqual({ vehicleId: 'bike-1', label: 'R6', count: 2 });
    expect(analytics.topTracks[0]).toEqual({ trackName: 'Road America', count: 2 });
    expect(analytics.moduleCoverage.find((item) => item.module === 'drivetrain')?.count).toBe(2);
    expect(analytics.tirePressureTrends.find((item) => item.label === 'R6 front')).toMatchObject({
      samples: 2,
      first: '31',
      latest: '32',
    });
    expect(analytics.environmentSnapshots.averageAmbientTemperatureC).toBe(25);
  });

  it('keeps tire pressure trends separate for vehicles with matching nicknames and skips disabled tires', () => {
    const sameNameCar: Vehicle = { ...car, id: 'car-2', nickname: 'R6' };
    const analytics = deriveSessionAnalytics([
      { session: session({ id: 's1', vehicle_id: 'bike-1' }), vehicle: motorcycle, environment: null },
      {
        session: session({
          id: 's2',
          vehicle_id: 'car-2',
          tires: {
            condition: 'used',
            front: { brand: 'Hoosier', compound: 'R7', pressure: '30' },
            rear: { brand: 'Hoosier', compound: 'R7', pressure: '29' },
          },
        }),
        vehicle: sameNameCar,
        environment: null,
      },
      {
        session: session({
          id: 's3',
          vehicle_id: 'bike-1',
          tires: {
            condition: 'used',
            front: { brand: 'Pirelli', compound: 'SC1', pressure: '99' },
            rear: { brand: 'Pirelli', compound: 'SC0', pressure: '88' },
          },
          enabled_modules: {
            tires: false,
            suspension: true,
            alignment: false,
            geometry: false,
            drivetrain: false,
            aero: false,
            notes: true,
          },
        }),
        vehicle: motorcycle,
        environment: null,
      },
    ]);

    const r6FrontTrends = analytics.tirePressureTrends.filter((item) => item.label === 'R6 front');
    expect(r6FrontTrends).toHaveLength(2);
    expect(r6FrontTrends.map((item) => item.first).sort()).toEqual(['30', '31']);
    expect(analytics.tirePressureTrends.some((item) => item.first === '99')).toBe(false);
  });
});
