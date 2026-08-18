import { describe, expect, it } from 'vitest';
import {
  calcFreeSag,
  calcRiderSag,
  calcSagPct,
  parseMeasurement,
  roundForDisplay,
  summarizeSagEntry,
} from '@/lib/sag';

describe('calcFreeSag', () => {
  it('returns l0 - l1 for valid numbers', () => {
    expect(calcFreeSag(120, 95)).toBe(25);
  });

  it('supports decimal values', () => {
    expect(calcFreeSag(120.5, 95.25)).toBe(25.25);
  });

  it('returns null when input is missing', () => {
    expect(calcFreeSag(null, 95)).toBeNull();
    expect(calcFreeSag(120, null)).toBeNull();
  });

  it('returns negative result when l0 < l1', () => {
    expect(calcFreeSag(90, 100)).toBe(-10);
  });
});

describe('calcRiderSag', () => {
  it('returns l0 - l2 for valid numbers', () => {
    expect(calcRiderSag(120, 80)).toBe(40);
  });

  it('supports decimal values', () => {
    expect(calcRiderSag(120.5, 79.9)).toBeCloseTo(40.6, 6);
  });

  it('returns null when input is missing', () => {
    expect(calcRiderSag(null, 80)).toBeNull();
    expect(calcRiderSag(120, null)).toBeNull();
  });

  it('returns negative result when l0 < l2', () => {
    expect(calcRiderSag(95, 100)).toBe(-5);
  });
});

describe('calcSagPct', () => {
  it('returns percentage for valid sag and travel', () => {
    expect(calcSagPct(30, 120)).toBe(25);
  });

  it('returns null when travel is zero or missing', () => {
    expect(calcSagPct(30, 0)).toBeNull();
    expect(calcSagPct(30, null)).toBeNull();
  });

  it('returns null when sag is missing', () => {
    expect(calcSagPct(null, 120)).toBeNull();
  });

  it('does not round raw result', () => {
    expect(calcSagPct(23, 113)).toBeCloseTo(20.3539823, 6);
  });
});

describe('parseMeasurement', () => {
  it('parses integers and decimals', () => {
    expect(parseMeasurement('120')).toBe(120);
    expect(parseMeasurement('120.5')).toBe(120.5);
  });

  it('returns null for empty string', () => {
    expect(parseMeasurement('')).toBeNull();
    expect(parseMeasurement('   ')).toBeNull();
  });

  it('returns null for invalid input', () => {
    expect(parseMeasurement('abc')).toBeNull();
  });
});

describe('roundForDisplay', () => {
  it('returns em dash for null input', () => {
    expect(roundForDisplay(null)).toBe('—');
  });

  it('rounds to one decimal place', () => {
    expect(roundForDisplay(20)).toBe('20.0');
    expect(roundForDisplay(20.36)).toBe('20.4');
  });
});

describe('summarizing a saved entry for the history list', () => {
  const empty = {
    front_l0: null,
    front_l1: null,
    front_l2: null,
    rear_l0: null,
    rear_l1: null,
    rear_l2: null,
  };

  it('reports free and rider sag per axle so two entries can be told apart', () => {
    expect(
      summarizeSagEntry({
        front_l0: 590,
        front_l1: 560,
        front_l2: 555,
        rear_l0: 320,
        rear_l1: 305,
        rear_l2: 288,
      }),
    ).toEqual([
      { axle: 'Front', freeSagMm: 30, riderSagMm: 35 },
      { axle: 'Rear', freeSagMm: 15, riderSagMm: 32 },
    ]);
  });

  it('leaves out an axle that was never measured', () => {
    expect(summarizeSagEntry({ ...empty, front_l0: 590, front_l2: 555 })).toEqual([
      { axle: 'Front', freeSagMm: null, riderSagMm: 35 },
    ]);
  });

  it('says nothing at all for an entry with no usable measurements', () => {
    expect(summarizeSagEntry(empty)).toEqual([]);
    // L0 alone cannot produce a sag figure.
    expect(summarizeSagEntry({ ...empty, front_l0: 590 })).toEqual([]);
  });
});
