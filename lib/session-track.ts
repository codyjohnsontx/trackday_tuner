/**
 * The circuit a session names, and the track row it belongs to.
 *
 * `sessions.track_name` is denormalised so a session still reads correctly after
 * the track it came from is renamed or deleted, but `track_id` is what the tracks
 * list, the track page and every link to one key on - and the New Session form
 * leaves it null whenever the rider types a circuit instead of picking a saved
 * one. A rider whose home track is not one of the seeded ones therefore logged a
 * whole season the Tracks screen said did not exist, and retyped the name every
 * time, so one typo silently split their history in two.
 *
 * These helpers state what counts as the same circuit. Case and spacing are not a
 * different track: `cota` and `COTA` are one, and so are `Barber  Motorsports
 * Park` and `Barber Motorsports Park`.
 */

/** The stored form of a typed track name: trimmed, or null when nothing was typed. */
export function normalizeTrackName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Two spellings of the same circuit, as a comparable key. */
export function trackNameKey(value: string | null | undefined): string {
  // NFC as well as case and spacing: an accent typed decomposed ("Auto\u0301dromo")
  // is the same circuit as the precomposed form, and folding only the first two
  // would still split it into two rows.
  return (value ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * True for a character a `like` pattern cannot state literally.
 *
 * Two kinds qualify. `%`, `_`, `\` and PostgREST's `*` alias are wildcards, so a
 * name containing one has to give up matching it exactly rather than depend on
 * escaping surviving the wire. Anything whose NFD form differs from itself, and
 * any combining mark, is a composition the key folds away: the stored row may
 * hold either spelling, and `like` compares code points.
 */
function needsWildcard(char: string): boolean {
  if (char === '%' || char === '_' || char === '\\' || char === '*') return true;
  return char.normalize('NFD') !== char || /\p{M}/u.test(char);
}

/**
 * A `like` pattern that narrows a track query to the rows a typed name could mean.
 *
 * The lookup used to read every track the rider can see and fold in memory, which
 * PostgREST truncates at `max_rows` - so past that a circuit they already have
 * reads as one they have never logged, and gets duplicated into one of their
 * three custom-track slots. This narrows it in the database instead.
 *
 * It is a narrowing step and not the decision: `findSavedTrackByName` still says
 * whether two spellings are one circuit, so this pattern must never be tighter
 * than the fold. Spacing becomes `%` because the fold collapses runs of it, and
 * every character the pattern cannot state literally becomes `%` too. Wider than
 * the fold is only wasted rows; narrower is the duplicate row this exists to
 * prevent.
 */
export function trackNameSearchPattern(value: string | null | undefined): string {
  const key = trackNameKey(value);
  if (!key) return '%';

  let pattern = '';
  for (const char of key) {
    pattern += char === ' ' || needsWildcard(char) ? '%' : char;
  }

  return pattern.replace(/%+/g, '%');
}

/** The saved track a typed name means, or null when the rider is naming a new one. */
export function findSavedTrackByName<T extends { name: string }>(
  name: string | null | undefined,
  tracks: readonly T[],
): T | null {
  const key = trackNameKey(name);
  if (!key) return null;

  return tracks.find((track) => trackNameKey(track.name) === key) ?? null;
}
