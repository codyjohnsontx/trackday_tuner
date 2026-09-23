import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { riderDateOfTimestamp, todayLocalDate } from '@/lib/local-date';

// The bug this guards only shows up where local time and UTC disagree about the
// day, so the timezone is pinned rather than inherited: CI runs in UTC, where a
// UTC-derived date is accidentally correct and every assertion below would pass
// against the implementation that was wrong for every American rider.
const originalTimeZone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'America/Chicago';
});

afterAll(() => {
  // Assigning undefined would store the string "undefined" and leave every later
  // suite in an unparseable zone.
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

describe('todayLocalDate', () => {
  it('returns the day the rider is living in, not the UTC day', () => {
    // 23:30 on a Sunday in Texas is already Monday in London.
    const sundayEvening = new Date(2026, 7, 16, 23, 30, 0);
    expect(sundayEvening.toISOString().split('T')[0]).toBe('2026-08-17');

    expect(todayLocalDate(sundayEvening)).toBe('2026-08-16');
  });

  it('agrees with UTC during the part of the day the two share', () => {
    const morning = new Date(2026, 7, 16, 9, 0, 0);
    expect(todayLocalDate(morning)).toBe('2026-08-16');
  });

  it('pads month and day so the value parses as a date input value', () => {
    expect(todayLocalDate(new Date(2026, 0, 5, 20, 0, 0))).toBe('2026-01-05');
  });
});

// The zone is passed explicitly, so the TZ pinned above must not matter: a
// server in UTC and one in Chicago have to name the same rider day.
describe('riderDateOfTimestamp', () => {
  it('names the day behind UTC for a rider west of Greenwich', () => {
    expect(riderDateOfTimestamp('2026-04-02T01:00:00Z', 'America/Chicago')).toBe('2026-04-01');
  });

  it('names the day ahead of UTC for a rider east of Greenwich', () => {
    expect(riderDateOfTimestamp('2026-04-01T23:00:00Z', 'Asia/Tokyo')).toBe('2026-04-02');
  });

  it('reads the offset Supabase actually returns', () => {
    expect(riderDateOfTimestamp('2026-04-02T01:00:00.123456+00:00', 'America/Chicago')).toBe(
      '2026-04-01',
    );
  });

  it.each([undefined, '', 'Not/AZone'])('falls back to the UTC date for zone %s', (zone) => {
    expect(riderDateOfTimestamp('2026-04-02T01:00:00Z', zone)).toBe('2026-04-02');
  });

  it('falls back to the stored prefix when the timestamp does not parse', () => {
    expect(riderDateOfTimestamp('2026-04-02 garbage', 'America/Chicago')).toBe('2026-04-02');
  });
});
