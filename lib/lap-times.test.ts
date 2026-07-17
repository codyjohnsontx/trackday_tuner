import { describe, expect, it } from 'vitest';
import { aggregateLaps, parseLapList, parseLapTime, validateLaps } from '@/lib/lap-times';

describe('lap time parsing', () => {
  it('accepts minute and total-second formats', () => {
    expect(parseLapTime('1:42.350')).toBe(102350);
    expect(parseLapTime('102.350')).toBe(102350);
  });

  it('parses explicit lap labels and reports invalid lines', () => {
    const result = parseLapList('Lap 3: 1:42.350\nnope');
    expect(result[0].lap).toMatchObject({ lap_number: 3, lap_time_ms: 102350 });
    expect(result[1].error).toContain('Line 2');
  });

  it('rejects duplicate explicit numbers', () => {
    expect(parseLapList('Lap 2: 1:40.000\nLap 2: 1:41.000')[1].error).toContain('duplicated');
  });
});

describe('lap aggregation', () => {
  it('excludes warm-up laps from metrics', () => {
    const laps = [
      { lap_number: 1, lap_time_ms: 120000, included: false },
      { lap_number: 2, lap_time_ms: 100000, included: true },
      { lap_number: 3, lap_time_ms: 102000, included: true },
    ];
    expect(validateLaps(laps)).toBeNull();
    expect(aggregateLaps(laps)).toEqual({
      lap_count: 2,
      best_lap_ms: 100000,
      average_lap_ms: 101000,
      consistency_spread_ms: 2000,
      lap_times_ms: [100000, 102000],
    });
  });
});
