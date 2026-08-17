import { describe, expect, it } from 'vitest';
import { findSavedTrackByName, normalizeTrackName, trackNameKey } from '@/lib/session-track';

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
