import { describe, expect, it } from 'vitest';
import {
  computeUsage,
  estimateSessionUsage,
  latestReading,
  type UsageBook,
  type UsageInput,
  type UsageLap,
  type UsageReading,
  type UsageSession,
} from '@/lib/service-book/usage';

const book: UsageBook = {
  tracks_hours: true,
  tracks_distance: true,
  default_session_minutes: 20,
  default_session_distance: null,
};

function reading(id: string, date: string, values: { hours?: number; distance?: number }, extra: Partial<UsageReading> = {}): UsageReading {
  return {
    id,
    reading_date: date,
    read_at: `${date}T12:00:00Z`,
    hours: values.hours ?? null,
    distance: values.distance ?? null,
    supersedes_id: null,
    ...extra,
  };
}

function session(id: string, date: string, createdAt = `${date}T15:00:00Z`): UsageSession {
  return { id, date, created_at: createdAt };
}

function laps(sessionId: string, ...times: number[]): UsageLap[] {
  return times.map((lap_time_ms) => ({ session_id: sessionId, lap_time_ms, included: true }));
}

function input(overrides: Partial<UsageInput> = {}): UsageInput {
  return { book, readings: [], sessions: [], laps: [], weights: [], ...overrides };
}

describe('one session', () => {
  it('counts its included lap times as time on track', () => {
    const usage = estimateSessionUsage(book, session('s', '2026-09-01'), [
      ...laps('s', 120_000, 120_000, 120_000),
      { session_id: 's', lap_time_ms: 600_000, included: false },
    ]);
    expect(usage.minutesBasis).toBe('laps');
    expect(usage.minutes).toBe(6);
    expect(usage.hours).toBeCloseTo(0.1);
  });

  it('falls back to the book default with no laps, or none included', () => {
    expect(estimateSessionUsage(book, session('s', '2026-09-01'), []).minutesBasis).toBe('default');
    const excluded = estimateSessionUsage(book, session('s', '2026-09-01'), [
      { session_id: 's', lap_time_ms: 90_000, included: false },
    ]);
    expect(excluded.minutesBasis).toBe('default');
    expect(excluded.hours).toBeCloseTo(20 / 60);
  });

  it('lets the rider override minutes and distance outright, laps notwithstanding', () => {
    const usage = estimateSessionUsage(book, session('s', '2026-09-01'), laps('s', 120_000), {
      session_id: 's',
      weight: 1,
      minutes_override: 90,
      distance_override: 40,
    });
    expect(usage).toMatchObject({ minutesBasis: 'override', minutes: 90, hours: 1.5, distanceBasis: 'override', distance: 40 });
  });

  it('scales by the rider weight: 0 is a day that does not count, 2 a big day', () => {
    const none = estimateSessionUsage({ ...book, default_session_distance: 30 }, session('s', '2026-09-01'), [], {
      session_id: 's',
      weight: 0,
      minutes_override: null,
      distance_override: null,
    });
    expect(none).toMatchObject({ weight: 0, minutes: 20, hours: 0, distance: 0 });

    const cota = estimateSessionUsage(book, session('s', '2026-09-01'), laps('s', 1_800_000), {
      session_id: 's',
      weight: 2,
      minutes_override: null,
      distance_override: null,
    });
    expect(cota.hours).toBe(1);
  });

  it('has no distance to give with neither an override nor a book default', () => {
    const usage = estimateSessionUsage(book, session('s', '2026-09-01'), []);
    expect(usage).toMatchObject({ distanceBasis: null, distance: null });
  });
});

describe('the bike', () => {
  it('reads as the latest reading when nothing has been logged since', () => {
    const usage = computeUsage(
      input({ readings: [reading('a', '2026-08-01', { hours: 8 }), reading('b', '2026-09-20', { hours: 10 })] }),
    );
    expect(usage.hours).toMatchObject({ basis: 'reading', current: 10, estimate: 0, reading: { id: 'b', value: 10 } });
  });

  it('adds sessions after the latest reading as an estimate, and only those', () => {
    const usage = computeUsage(
      input({
        readings: [reading('r', '2026-09-20', { hours: 10 })],
        sessions: [session('before', '2026-09-10'), session('after', '2026-09-25')],
        laps: [...laps('before', 3_600_000), ...laps('after', 1_800_000, 1_800_000)],
      }),
    );
    expect(usage.hours?.basis).toBe('reading_plus_estimate');
    expect(usage.hours?.sessions.map((s) => s.sessionId)).toEqual(['after']);
    expect(usage.hours?.estimate).toBe(1);
    expect(usage.hours?.current).toBe(11);
  });

  it('on the reading date counts only the sessions logged after the reading was', () => {
    const usage = computeUsage(
      input({
        readings: [reading('r', '2026-09-20', { hours: 10 })],
        sessions: [
          session('morning', '2026-09-20', '2026-09-20T09:00:00Z'),
          session('afternoon', '2026-09-20', '2026-09-20T16:00:00Z'),
        ],
      }),
    );
    expect(usage.hours?.sessions.map((s) => s.sessionId)).toEqual(['afternoon']);
  });

  it('reads the latest reading nothing supersedes, so a correction replaces the value it corrects', () => {
    const readings = [
      reading('typo', '2026-09-20', { hours: 100 }),
      reading('fix', '2026-09-18', { hours: 10 }, { supersedes_id: 'typo', read_at: '2026-09-21T08:00:00Z' }),
    ];
    expect(latestReading(readings, 'hours')?.id).toBe('fix');
    expect(computeUsage(input({ readings })).hours?.current).toBe(10);
  });

  it('reads hours and distance from their own latest readings', () => {
    const usage = computeUsage(
      input({
        readings: [reading('h', '2026-09-20', { hours: 10 }), reading('d', '2026-09-01', { distance: 1200 })],
      }),
    );
    expect(usage.hours?.reading?.id).toBe('h');
    expect(usage.distance?.reading?.id).toBe('d');
  });

  it('counts a weight-0 session and adds nothing for it', () => {
    const usage = computeUsage(
      input({
        readings: [reading('r', '2026-09-20', { hours: 10 })],
        sessions: [session('small-track', '2026-09-25')],
        weights: [{ session_id: 'small-track', weight: 0, minutes_override: null, distance_override: null }],
      }),
    );
    expect(usage.hours).toMatchObject({ basis: 'reading', current: 10, estimate: 0 });
    expect(usage.hours?.sessions[0].weight).toBe(0);
  });

  it('skips the axes the book does not track', () => {
    const usage = computeUsage(input({ book: { ...book, tracks_distance: false } }));
    expect(usage.distance).toBeNull();
  });

  describe('with no readings at all', () => {
    it('counts from zero at the first session, labelled estimate only', () => {
      const usage = computeUsage(input({ sessions: [session('a', '2026-09-01'), session('b', '2026-09-02')] }));
      expect(usage.hours).toMatchObject({ basis: 'estimate_only', reading: null });
      expect(usage.hours?.current).toBeCloseTo(40 / 60);
    });

    it('has nothing to say with no sessions either', () => {
      expect(computeUsage(input()).hours).toMatchObject({ basis: 'none', current: null });
    });

    it('does not turn sessions with no distance into a distance of zero', () => {
      const usage = computeUsage(input({ sessions: [session('a', '2026-09-01')] }));
      expect(usage.distance).toMatchObject({ basis: 'none', current: null, sessionsWithoutDistance: 1 });
    });
  });

  it('counts sessions missing a distance on top of a reading rather than hiding them', () => {
    const usage = computeUsage(
      input({
        readings: [reading('r', '2026-09-20', { distance: 1000 })],
        sessions: [session('a', '2026-09-21'), session('b', '2026-09-22')],
        weights: [{ session_id: 'a', weight: 1, minutes_override: null, distance_override: 55 }],
      }),
    );
    expect(usage.distance).toMatchObject({ current: 1055, sessionsWithoutDistance: 1 });
  });

  it('as of a date, reads readings on or before it and sessions strictly before it', () => {
    const usage = computeUsage(
      input({
        readings: [reading('old', '2026-08-01', { hours: 5 }), reading('new', '2026-09-30', { hours: 20 })],
        sessions: [session('a', '2026-08-10'), session('same-day', '2026-09-01')],
      }),
      { asOf: '2026-09-01' },
    );
    expect(usage.hours?.reading?.id).toBe('old');
    expect(usage.hours?.sessions.map((s) => s.sessionId)).toEqual(['a']);
  });

  it('does not throw on values jsonb or a bad cast could hand it', () => {
    const usage = computeUsage(
      input({
        readings: [reading('r', '2026-09-20', { hours: Number.NaN })],
        sessions: [session('a', '2026-09-21')],
        weights: [{ session_id: 'a', weight: Number.NaN, minutes_override: null, distance_override: null }],
      }),
    );
    expect(usage.hours).toMatchObject({ basis: 'estimate_only', reading: null });
    expect(usage.hours?.sessions[0].weight).toBe(1);
  });
});
