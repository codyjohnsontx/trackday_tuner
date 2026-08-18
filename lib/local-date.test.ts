import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayLocalDate } from '@/lib/local-date';

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
