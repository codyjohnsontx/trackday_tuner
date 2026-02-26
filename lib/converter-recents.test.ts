import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONVERTER_RECENTS_KEY,
  loadRecentPairs,
  recordRecentPair,
  saveRecentPairs,
} from '@/lib/converter-recents';
import type { ConverterPair } from '@/lib/converter';

const store = new Map<string, string>();

const localStorageMock = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    store.delete(key);
  }),
};

const psiToBar: ConverterPair = {
  category: 'pressure',
  fromUnit: 'psi',
  toUnit: 'bar',
};

describe('converter recents', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    vi.stubGlobal('window', { localStorage: localStorageMock });
  });

  it('saves and loads recent pairs', () => {
    saveRecentPairs([psiToBar]);
    expect(loadRecentPairs()).toEqual([psiToBar]);
  });

  it('handles malformed localStorage safely', () => {
    store.set(CONVERTER_RECENTS_KEY, 'not-json');
    expect(loadRecentPairs()).toEqual([]);
  });

  it('promotes existing pair to top and dedupes', () => {
    const fToC: ConverterPair = {
      category: 'temperature',
      fromUnit: 'F',
      toUnit: 'C',
    };
    const result = recordRecentPair([psiToBar, fToC], psiToBar);
    expect(result).toEqual([psiToBar, fToC]);
  });

  it('adds new pairs to the top in MRU order', () => {
    const fToC: ConverterPair = {
      category: 'temperature',
      fromUnit: 'F',
      toUnit: 'C',
    };
    const result = recordRecentPair([psiToBar], fToC);
    expect(result).toEqual([fToC, psiToBar]);
  });

  it('caps recents at 5 entries and drops the oldest', () => {
    const pairs: ConverterPair[] = [
      { category: 'pressure', fromUnit: 'psi', toUnit: 'bar' },
      { category: 'pressure', fromUnit: 'bar', toUnit: 'psi' },
      { category: 'temperature', fromUnit: 'F', toUnit: 'C' },
      { category: 'temperature', fromUnit: 'C', toUnit: 'F' },
      { category: 'torque', fromUnit: 'Nm', toUnit: 'ft-lb' },
    ];
    const extra: ConverterPair = {
      category: 'torque',
      fromUnit: 'ft-lb',
      toUnit: 'Nm',
    };

    const result = recordRecentPair(pairs, extra);
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual(extra);
    expect(result).not.toContainEqual({ category: 'torque', fromUnit: 'Nm', toUnit: 'ft-lb' });
  });

  it('filters malformed entries during load', () => {
    store.set(
      CONVERTER_RECENTS_KEY,
      JSON.stringify([psiToBar, { category: 123, fromUnit: 'x', toUnit: 'y' }]),
    );

    expect(loadRecentPairs()).toEqual([psiToBar]);
  });
});
