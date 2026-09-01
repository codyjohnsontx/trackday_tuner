import { describe, expect, it } from 'vitest';
import {
  buildSessionExportCsv,
  deriveSessionAnalytics,
  escapeCsvValue,
  flattenSessionForExport,
} from '@/lib/session-export';
import type { Session, SessionEnvironment, TelemetryMetrics, TelemetrySummary, Vehicle } from '@/types';

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

function telemetry(metrics: TelemetryMetrics, overrides: Partial<TelemetrySummary> = {}): TelemetrySummary {
  return {
    id: 'telemetry-1',
    user_id: 'user-1',
    session_id: 'session-1',
    vehicle_id: 'bike-1',
    source: 'manual',
    summary: null,
    metrics,
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
      telemetry: null,
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
      telemetry: null,
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
        telemetry: null,
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
      { session: session({ id: 's1', date: '2026-05-01', vehicle_id: 'bike-1' }), vehicle: motorcycle, environment: environment(), telemetry: null },
      { session: session({ id: 's2', date: '2026-05-02', vehicle_id: 'bike-1', tires: { ...session().tires, front: { ...session().tires.front, pressure: '32' } } }), vehicle: motorcycle, environment: null, telemetry: null },
      { session: session({ id: 's3', vehicle_id: 'car-1', track_name: 'Laguna Seca' }), vehicle: car, environment: environment({ ambient_temperature_c: 26 }), telemetry: null },
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

  /**
   * The panel labelled Analytics is handed every session's telemetry and used
   * to throw it away, so it answered with session counts, module coverage and
   * tire pressures while the rows on the same page carried best laps and lap
   * counts. These are the numbers it was missing.
   */
  it('totals the laps it is handed', () => {
    const analytics = deriveSessionAnalytics([
      {
        session: session({ id: 's1', date: '2026-05-01' }),
        vehicle: motorcycle,
        environment: null,
        telemetry: telemetry({ lap_times_ms: [104620, 104110, 103980, 104250] }),
      },
      {
        session: session({ id: 's2', date: '2026-05-02' }),
        vehicle: motorcycle,
        environment: null,
        telemetry: telemetry({ lap_times_ms: [103920, 103640] }, { session_id: 's2' }),
      },
      { session: session({ id: 's3', date: '2026-05-03' }), vehicle: motorcycle, environment: null, telemetry: null },
    ]);

    expect(analytics.laps).toEqual({ totalLaps: 6, sessionsWithLaps: 2 });
    expect(analytics.moduleCoverage.find((row) => row.module === 'lap_times')).toEqual({
      module: 'lap_times',
      count: 2,
      percent: 67,
    });
  });

  it('reports zero laps rather than nothing when no session carries any', () => {
    const analytics = deriveSessionAnalytics([
      { session: session({ id: 's1' }), vehicle: motorcycle, environment: null, telemetry: null },
    ]);

    expect(analytics.laps).toEqual({ totalLaps: 0, sessionsWithLaps: 0 });
    expect(analytics.bestLapByTrack).toEqual([]);
  });

  /**
   * `environment` moved out of the headline strip, where a logging diagnostic
   * sat in the slot the lap total belongs in, and into the coverage list beside
   * every other "how much did you fill in" number.
   */
  it('counts environment rows as coverage rather than a headline number', () => {
    const analytics = deriveSessionAnalytics([
      { session: session({ id: 's1' }), vehicle: motorcycle, environment: environment(), telemetry: null },
      { session: session({ id: 's2' }), vehicle: motorcycle, environment: null, telemetry: null },
    ]);

    expect(analytics.moduleCoverage.find((row) => row.module === 'environment')).toEqual({
      module: 'environment',
      count: 1,
      percent: 50,
    });
    expect(analytics.environmentSnapshots.withEnvironment).toBe(1);
  });

  it('keeps a best lap per circuit, most recently run first', () => {
    const analytics = deriveSessionAnalytics([
      {
        session: session({ id: 's1', date: '2026-05-01', track_id: 'track-1', track_name: 'Road America' }),
        vehicle: motorcycle,
        environment: null,
        telemetry: telemetry({ lap_times_ms: [104620, 103980] }),
      },
      {
        session: session({ id: 's2', date: '2026-05-02', track_id: 'track-1', track_name: 'Road America' }),
        vehicle: motorcycle,
        environment: null,
        telemetry: telemetry({ lap_times_ms: [104100] }, { session_id: 's2' }),
      },
      {
        session: session({ id: 's3', date: '2026-06-01', track_id: 'track-2', track_name: 'Laguna Seca' }),
        vehicle: car,
        environment: null,
        telemetry: telemetry({ lap_times_ms: [92500] }, { session_id: 's3', vehicle_id: 'car-1' }),
      },
    ]);

    expect(analytics.bestLapByTrack.map((best) => [best.trackName, best.bestLap, best.vehicleLabel])).toEqual([
      ['Laguna Seca', '1:32.500', 'Miata'],
      ['Road America', '1:43.980', 'R6'],
    ]);
  });

  /**
   * A lap compares against another lap on the same vehicle at the same track -
   * `getComparableSessions` filters `vehicle_id` before applying
   * `sessionsMatchTrack`. Keying the board on the circuit alone let the car's
   * lap beat the bike's and the bike's personal best appeared nowhere.
   */
  it('keeps a best lap per vehicle at one circuit', () => {
    const analytics = deriveSessionAnalytics([
      {
        session: session({ id: 's1', vehicle_id: 'bike-1', date: '2026-05-01', track_id: 'track-1' }),
        vehicle: motorcycle,
        environment: null,
        telemetry: telemetry({ lap_times_ms: [103980] }),
      },
      {
        session: session({ id: 's2', vehicle_id: 'car-1', date: '2026-05-02', track_id: 'track-1' }),
        vehicle: car,
        environment: null,
        telemetry: telemetry({ lap_times_ms: [92500] }, { session_id: 's2', vehicle_id: 'car-1' }),
      },
    ]);

    expect(analytics.bestLapByTrack.map((best) => [best.trackName, best.vehicleLabel, best.bestLap])).toEqual([
      ['Road America', 'Miata', '1:32.500'],
      ['Road America', 'R6', '1:43.980'],
    ]);
  });

  /**
   * A circuit typed by hand and the same circuit picked from the saved row are
   * one track, so they share one personal best. `sessionsMatchTrack` says so;
   * the board has to agree or a rider reads two records for one place.
   */
  it('folds a typed track name into the saved row it names', () => {
    const analytics = deriveSessionAnalytics([
      {
        session: session({ id: 's1', date: '2026-05-01', track_id: 'track-1', track_name: 'Road America' }),
        vehicle: motorcycle,
        environment: null,
        telemetry: telemetry({ lap_times_ms: [104620] }),
      },
      {
        session: session({ id: 's2', date: '2026-05-02', track_id: null, track_name: 'road  america' }),
        vehicle: motorcycle,
        environment: null,
        telemetry: telemetry({ lap_times_ms: [103500] }, { session_id: 's2' }),
      },
    ]);

    expect(analytics.bestLapByTrack).toHaveLength(1);
    expect(analytics.bestLapByTrack[0]).toMatchObject({ trackName: 'Road America', bestLap: '1:43.500' });
  });

  /**
   * The board is the only place these personal bests appear, and a capped list
   * rendered with no notice reads as the whole set - a rider with laps at seven
   * vehicle/circuit pairs saw five and had no way to tell. It once ended in
   * `.slice(0, 5)`, which hid the two oldest pairs; raising that number moves
   * the cliff rather than removing it, so there is no cap at all.
   */
  it('returns a board row for every vehicle/circuit pair the rider has lapped', () => {
    const pairs = [1, 2, 3, 4, 5, 6, 7];
    const analytics = deriveSessionAnalytics(
      pairs.map((n) => ({
        session: session({
          id: `s${n}`,
          date: `2026-05-0${n}`,
          track_id: `track-${n}`,
          track_name: `Circuit ${n}`,
        }),
        vehicle: motorcycle,
        environment: null,
        telemetry: telemetry({ lap_times_ms: [100000 + n] }, { session_id: `s${n}` }),
      })),
    );

    expect(analytics.bestLapByTrack).toHaveLength(pairs.length);
    expect(analytics.bestLapByTrack.map((best) => best.trackName)).toEqual([
      'Circuit 7',
      'Circuit 6',
      'Circuit 5',
      'Circuit 4',
      'Circuit 3',
      'Circuit 2',
      'Circuit 1',
    ]);
  });

  /**
   * `sessionsMatchTrack` pairs a session carrying neither a track row nor a
   * typed name with nothing - not even another session in the same state - so
   * the board must not either. Every one of them once shared the key `unknown`,
   * which merged genuinely separate track days into one row: only the fastest
   * survived, and the row named a circuit the rider had never been to.
   */
  it('keeps each trackless session its own board row', () => {
    const analytics = deriveSessionAnalytics([
      {
        session: session({
          id: 's1',
          date: '2026-05-01',
          session_number: 1,
          track_id: null,
          track_name: null,
        }),
        vehicle: motorcycle,
        environment: null,
        telemetry: telemetry({ lap_times_ms: [104620] }),
      },
      {
        session: session({
          id: 's2',
          date: '2026-06-14',
          session_number: 3,
          track_id: null,
          track_name: null,
        }),
        vehicle: motorcycle,
        environment: null,
        telemetry: telemetry({ lap_times_ms: [103980] }, { session_id: 's2' }),
      },
    ]);

    expect(analytics.bestLapByTrack).toHaveLength(2);
    // Two rows a rider cannot tell apart are the same defect one row is, so the
    // label carries what identifies the session: the day it ran and its number.
    expect(analytics.bestLapByTrack.map((best) => [best.trackName, best.bestLap])).toEqual([
      ['Unnamed track · 2026-06-14 · Session 3', '1:43.980'],
      ['Unnamed track · 2026-05-01 · Session 1', '1:44.620'],
    ]);
  });

  it('exports the lap columns the rider logged', () => {
    const row = flattenSessionForExport({
      session: session(),
      vehicle: motorcycle,
      environment: null,
      telemetry: telemetry({ lap_times_ms: [104620, 104110, 103980, 104250] }),
    });

    expect(row.lap_count).toBe(4);
    expect(row.best_lap).toBe('1:43.980');
    expect(row.best_lap_ms).toBe(103980);
    expect(row.average_lap).toBe('1:44.240');
    expect(row.average_lap_ms).toBe(104240);
    expect(row.consistency_spread_ms).toBe(640);
    // Space separated: comma and semicolon are both field delimiters some
    // readers sniff for, and a space is never one.
    expect(row.lap_times_ms).toBe('104620 104110 103980 104250');
  });

  /**
   * `telemetry_summaries.metrics` is unconstrained jsonb that `authenticated`
   * can write, so a zero or a negative reading is reachable. The aggregates drop
   * it, and the per-lap cell has to drop it too - a row reading `lap_count` 3
   * beside four printed times contradicts itself.
   */
  it('prints only the laps the aggregates counted', () => {
    const row = flattenSessionForExport({
      session: session(),
      vehicle: motorcycle,
      environment: null,
      telemetry: telemetry({ lap_times_ms: [104620, 0, 103980, -104250] }),
    });

    expect(row.lap_count).toBe(2);
    expect(row.lap_times_ms).toBe('104620 103980');
  });

  it('leaves the lap columns empty for a session with no laps', () => {
    const row = flattenSessionForExport({
      session: session(),
      vehicle: motorcycle,
      environment: null,
      telemetry: null,
    });

    for (const column of ['lap_count', 'best_lap', 'best_lap_ms', 'average_lap', 'average_lap_ms', 'consistency_spread_ms', 'lap_times_ms']) {
      expect(row[column]).toBeNull();
      expect(escapeCsvValue(row[column])).toBe('');
    }
  });

  it('keeps tire pressure trends separate for vehicles with matching nicknames and skips disabled tires', () => {
    const sameNameCar: Vehicle = { ...car, id: 'car-2', nickname: 'R6' };
    const analytics = deriveSessionAnalytics([
      { session: session({ id: 's1', vehicle_id: 'bike-1' }), vehicle: motorcycle, environment: null, telemetry: null },
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
        telemetry: null,
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
        telemetry: null,
      },
    ]);

    const r6FrontTrends = analytics.tirePressureTrends.filter((item) => item.label === 'R6 front');
    expect(r6FrontTrends).toHaveLength(2);
    expect(r6FrontTrends.map((item) => item.first).sort()).toEqual(['30', '31']);
    expect(analytics.tirePressureTrends.some((item) => item.first === '99')).toBe(false);
  });
});
