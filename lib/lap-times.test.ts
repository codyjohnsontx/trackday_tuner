import { describe, expect, it } from 'vitest';
import {
  EMPTY_LAP_EDITOR_VALUE,
  aggregateLaps,
  commitLapEditorValue,
  parseLapList,
  parseLapTime,
  validateLaps,
} from '@/lib/lap-times';

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

describe('committing pending lap-editor text', () => {
  const empty = EMPTY_LAP_EDITOR_VALUE;

  it('saves laps pasted but never parsed', () => {
    const result = commitLapEditorValue({
      ...empty,
      pending: { quick: '', paste: '1:42.350\n1:41.920\n1:41.700\n1:41.480' },
    });

    expect(result).toEqual({
      ok: true,
      laps: [
        { lap_number: 1, lap_time_ms: 102350, included: true },
        { lap_number: 2, lap_time_ms: 101920, included: true },
        { lap_number: 3, lap_time_ms: 101700, included: true },
        { lap_number: 4, lap_time_ms: 101480, included: true },
      ],
    });
  });

  it('saves a quick-add lap the rider never pressed Add on', () => {
    const result = commitLapEditorValue({ ...empty, pending: { quick: '1:40.900', paste: '' } });
    expect(result).toEqual({
      ok: true,
      laps: [{ lap_number: 1, lap_time_ms: 100900, included: true }],
    });
  });

  it('folds both boxes in behind the laps already added', () => {
    const result = commitLapEditorValue({
      laps: [{ lap_number: 1, lap_time_ms: 103000, included: true }],
      pending: { quick: '1:40.900', paste: '1:41.100' },
    });

    expect(result.ok && result.laps.map((lap) => lap.lap_time_ms)).toEqual([103000, 100900, 101100]);
  });

  it('leaves an untouched editor exactly as it was', () => {
    expect(commitLapEditorValue({ laps: [], pending: { quick: '  ', paste: '\n' } })).toEqual({
      ok: true,
      laps: [],
    });
  });

  it('fails the commit rather than discarding text it cannot read', () => {
    const result = commitLapEditorValue({ ...empty, pending: { quick: '', paste: 'not a lap time' } });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('Line 1');
  });

  it('renumbers pasted laps around ones already in the list', () => {
    const result = commitLapEditorValue({
      laps: [{ lap_number: 1, lap_time_ms: 103000, included: true }],
      pending: { quick: '', paste: 'Lap 1: 1:41.100' },
    });

    expect(result.ok && result.laps.map((lap) => lap.lap_number)).toEqual([1, 2]);
  });
});
