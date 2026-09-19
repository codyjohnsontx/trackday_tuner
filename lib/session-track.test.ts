import { describe, expect, it } from 'vitest';
import {
  describeSessionTrackGap,
  findSavedTrackByName,
  normalizeTrackName,
  trackNameExactPattern,
  trackNameKey,
  trackNameSearchPattern,
} from '@/lib/session-track';
import { getFreePlanLimitMessage, getFreePlanLimitTitle } from '@/lib/plans';

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
  /**
   * What the database does with the pattern, both halves of it. PostgREST
   * substitutes its `*` alias into the value first - modelling only SQL `LIKE`,
   * where `*` is an ordinary character, is what let an unescapable wildcard reach
   * the "exact" pattern unnoticed. Then `ilike` reads `%` as any run of
   * characters, `_` as any one, and a backslash as escaping the next, case folded.
   */
  function matches(pattern: string, storedName: string): boolean {
    const rewritten = pattern.replace(/\*/g, '%');
    const literal = (char: string) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    let source = '';
    for (let i = 0; i < rewritten.length; i += 1) {
      const char = rewritten[i];
      if (char === '\\' && i + 1 < rewritten.length) {
        i += 1;
        source += literal(rewritten[i]);
      } else if (char === '%') {
        source += '[\\s\\S]*';
      } else if (char === '_') {
        source += '[\\s\\S]';
      } else {
        source += literal(char);
      }
    }

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

  it('reaches a stored row nobody trimmed', () => {
    // The fold trims both sides, so a pattern anchored at both ends would be
    // narrower than the fold for any row that was inserted with the spacing on it.
    expect(matches(trackNameSearchPattern('Eagles Canyon Raceway'), '  Eagles Canyon Raceway ')).toBe(true);
  });

  it('does not widen into circuits the fold calls different', () => {
    expect(matches(trackNameSearchPattern('Barber Motorsports Park'), 'Barber Motorsport Park')).toBe(false);
    expect(matches(trackNameSearchPattern('COTA'), 'Circuit of the Americas')).toBe(false);
  });

  it('matches everything rather than nothing when no name was typed', () => {
    expect(trackNameSearchPattern('   ')).toBe('%');
    expect(trackNameSearchPattern(null)).toBe('%');
  });

  it('states the typed name literally on the exact pattern', () => {
    // No wildcard at all, so nothing about how the name is spelled can widen this
    // lookup into one the bound has to truncate.
    expect(trackNameExactPattern('  Eagles  Canyon Raceway ')).toBe('eagles canyon raceway');
    expect(trackNameExactPattern('COTA')).toBe('cota');
    expect(matches(trackNameExactPattern('Eagles Canyon Raceway'), 'Eagles Canyon Raceway')).toBe(true);
    expect(matches(trackNameExactPattern('Eagles Canyon Raceway'), 'Eagles  Canyon Raceway')).toBe(false);
  });

  it('escapes a wildcard the typed name itself contains', () => {
    expect(trackNameExactPattern('50% Circuit')).toBe('50\\% circuit');
    expect(trackNameExactPattern('Snake_Alley')).toBe('snake\\_alley');
    // Escaped means stated, not honoured: it reaches the circuit the rider named
    // and not the ones the bare wildcard would have swept in.
    expect(matches(trackNameExactPattern('50% Circuit'), '50% Circuit')).toBe(true);
    expect(matches(trackNameExactPattern('50% Circuit'), '50 Percent Circuit')).toBe(false);
    expect(matches(trackNameExactPattern('Snake_Alley'), 'Snake_Alley')).toBe(true);
    expect(matches(trackNameExactPattern('Snake_Alley'), 'Snake Alley')).toBe(false);
  });

  it('has no exact pattern for the wildcard escaping cannot reach', () => {
    // PostgREST substitutes `*` for `%` in a like value unconditionally, so `\*`
    // would arrive as `\%` - a literal percent sign rather than the asterisk the
    // rider typed. There is no pattern that states such a name exactly, so it
    // means the search pattern, and the caller runs one query instead of a broad
    // one it believes is narrow.
    expect(trackNameExactPattern('Turn *3 Kart Track')).toBe(
      trackNameSearchPattern('Turn *3 Kart Track'),
    );
    expect(trackNameExactPattern('Turn *3 Kart Track')).not.toContain('*');
    expect(matches(trackNameExactPattern('Turn *3 Kart Track'), 'Turn *3 Kart Track')).toBe(true);
  });
});

describe('telling a rider what their session\'s circuit is missing', () => {
  // A free rider holding their three custom tracks.
  const savedTracks = [
    { name: 'Circuit of the Americas' },
    { name: 'Home Kart Loop' },
    { name: 'Club Circuit' },
    { name: 'Airfield Course' },
  ];

  it('explains a typed circuit the free-plan track cap kept off their tracks', () => {
    const gap = describeSessionTrackGap({
      trackId: null,
      trackName: '  Thunderhill West ',
      savedTracks,
      atTrackLimit: true,
    });

    expect(gap?.kind).toBe('track_limit');
    if (gap?.kind !== 'track_limit') return;
    // In the app's own cap vocabulary, naming what was typed, what it costs and
    // what to do - not a code.
    expect(gap.title).toBe(getFreePlanLimitTitle('tracks'));
    expect(gap.message).toContain('"Thunderhill West" is not one of your saved tracks');
    expect(gap.message).toContain('cannot be added to them');
    expect(gap.message).toContain(getFreePlanLimitMessage('tracks'));
    // The name the form holds a Save back for, trimmed the way it is stored, and
    // the line that says why the Save did nothing and how to get past it.
    expect(gap.name).toBe('Thunderhill West');
    expect(gap.holdSaveMessage).toContain('"Thunderhill West" is not one of your saved tracks');
    expect(gap.holdSaveMessage).toContain('tap Save again');
  });

  it('still reports a session that names no circuit as trackless, cap or not', () => {
    for (const atTrackLimit of [true, false]) {
      for (const trackName of [null, '', '   ']) {
        expect(describeSessionTrackGap({ trackId: null, trackName, savedTracks, atTrackLimit })).toEqual({
          kind: 'missing',
        });
      }
    }
    // As the session page always had it: a name is what it keyed on, not the id.
    expect(
      describeSessionTrackGap({ trackId: 'mine-1', trackName: null, savedTracks, atTrackLimit: false }),
    ).toEqual({ kind: 'missing' });
  });

  it('says nothing when the circuit has a track row behind it', () => {
    expect(
      describeSessionTrackGap({ trackId: 'mine-1', trackName: 'Thunderhill West', savedTracks, atTrackLimit: true }),
    ).toBeNull();
  });

  it('says nothing about the cap for a circuit that is already one of their tracks', () => {
    // Retyped with different capitals and spacing: still the saved row, which
    // `resolveSessionTrack` links without spending a slot.
    expect(
      describeSessionTrackGap({ trackId: null, trackName: 'club  CIRCUIT', savedTracks, atTrackLimit: true }),
    ).toBeNull();
  });

  it('says nothing about the cap to a rider who can still add a track', () => {
    expect(
      describeSessionTrackGap({ trackId: null, trackName: 'Thunderhill West', savedTracks, atTrackLimit: false }),
    ).toBeNull();
  });
});
