import type { ConverterPair } from '@/lib/converter';

export const CONVERTER_RECENTS_KEY = 'track_tuner:converter:recent_pairs';
const MAX_RECENTS = 5;

function isValidPair(value: unknown): value is ConverterPair {
  if (!value || typeof value !== 'object') return false;
  const pair = value as Record<string, unknown>;
  return (
    typeof pair.category === 'string' &&
    typeof pair.fromUnit === 'string' &&
    typeof pair.toUnit === 'string'
  );
}

function isSamePair(a: ConverterPair, b: ConverterPair) {
  return (
    a.category === b.category &&
    a.fromUnit === b.fromUnit &&
    a.toUnit === b.toUnit
  );
}

export function loadRecentPairs(): ConverterPair[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(CONVERTER_RECENTS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPair).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function saveRecentPairs(pairs: ConverterPair[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    CONVERTER_RECENTS_KEY,
    JSON.stringify(pairs.slice(0, MAX_RECENTS)),
  );
}

export function recordRecentPair(
  pairs: ConverterPair[],
  pair: ConverterPair,
): ConverterPair[] {
  const deduped = pairs.filter((item) => !isSamePair(item, pair));
  return [pair, ...deduped].slice(0, MAX_RECENTS);
}
