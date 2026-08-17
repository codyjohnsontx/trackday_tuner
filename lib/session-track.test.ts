import { describe, expect, it } from 'vitest';
import {
  findSavedTrackByName,
  normalizeTrackName,
  trackNameKey,
  trackNameSearchPattern,
} from '@/lib/session-track';

describe('naming a circuit', () => {
  it('treats blank input as no track at all', () => {
    expect(normalizeTrackName('   ')).toBeNull();
    expect(normalizeTrackName(null)).toBeNull();
    expect(normalizeTrackName(undefined)).toBeNull();
    expect(normalizeTrackName('  Barber Motorsports Park ')).toBe('Barber Motorsports Park');
  });

  it('folds case and repeated spacing, which is what splits a season in two', () => {
    expect(trackNameKey('COTA')).toBe(trackNameKey('cota'));
    expect(trackNameKey('Barber  Motorsports   Park')).toBe(trackNameKey('Barber Motorsports Park'));
    expect(trackNameKey('  Eagles Canyon ')).toBe('eagles canyon');
  });

  it('folds a decomposed accent onto its precomposed form', () => {
    // Typed with a combining acute versus a single precomposed character: one
    // circuit, and without NFC it would split into two rows.
    expect(trackNameKey('Auto\u0301dromo Hermanos Rodri\u0301guez')).toBe(
      trackNameKey('Autódromo Hermanos Rodríguez'),
    );
  });

  it('does not fold two genuinely different circuits together', () => {
    expect(trackNameKey('Barber Motorsports Park')).not.toBe(trackNameKey('Barber Motorsport Park'));
  });
});

describe('matching a typed name against saved tracks', () => {
  const tracks = [
    { id: 'seeded-1', name: 'Circuit of the Americas' },
    { id: 'mine-1', name: 'Eagles Canyon Raceway' },
  ];

  it('lands a typed name on the row it names', () => {
    expect(findSavedTrackByName('eagles  canyon raceway', tracks)).toEqual(tracks[1]);
    expect(findSavedTrackByName('CIRCUIT OF THE AMERICAS', tracks)).toEqual(tracks[0]);
  });

  it('returns null for a circuit the rider has not saved yet', () => {
    expect(findSavedTrackByName('Harris Hill Raceway', tracks)).toBeNull();
  });

  it('returns null rather than matching everything on a blank name', () => {
    expect(findSavedTrackByName('', tracks)).toBeNull();
    expect(findSavedTrackByName(null, tracks)).toBeNull();
  });
});

describe('narrowing a track query to a typed name', () => {
  /** What `ilike` does with the pattern: `%` is any run of characters, case folded. */
  function matches(pattern: string, storedName: string): boolean {
    const source = pattern
      .split('%')
      .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\s\\S]*');
    return new RegExp(`^${source}$`, 'i').test(storedName);
  }

  it('still reaches every spelling the fold calls one circuit', () => {
    // Narrower than the fold means a duplicate row for a circuit the rider has.
    const pattern = trackNameSearchPattern('eagles  canyon raceway');
    expect(matches(pattern, 'Eagles Canyon Raceway')).toBe(true);
    expect(matches(pattern, 'EAGLES  CANYON  RACEWAY')).toBe(true);
  });

  it('reaches either Unicode composition of an accent', () => {
    const pattern = trackNameSearchPattern('Aut\u00f3dromo Hermanos Rodr\u00edguez');
    expect(matches(pattern, 'Aut\u00f3dromo Hermanos Rodr\u00edguez')).toBe(true);
    expect(matches(pattern, 'Auto\u0301dromo Hermanos Rodri\u0301guez')).toBe(true);
  });

  it('does not widen into circuits the fold calls different', () => {
    expect(matches(trackNameSearchPattern('Barber Motorsports Park'), 'Barber Motorsport Park')).toBe(false);
    expect(matches(trackNameSearchPattern('COTA'), 'Circuit of the Americas')).toBe(false);
  });

  it('matches everything rather than nothing when no name was typed', () => {
    expect(trackNameSearchPattern('   ')).toBe('%');
    expect(trackNameSearchPattern(null)).toBe('%');
  });
});
