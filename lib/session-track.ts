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
 *
 * They also state that a session names one at all. Vehicle and Date were both
 * validated while Track was not, so a rider who scrolled past it saved a session
 * that reads "Unknown Track", reaches no track history, and is refused by
 * `buildPaceComparison` as a comparison "at a different track" - all of it
 * silent. `MISSING_TRACK_MESSAGE` and `hasTrackName` are the rule the form and
 * `createSession` both check, so the two cannot disagree about it.
 */

/** The stored form of a typed track name: trimmed, or null when nothing was typed. */
export function normalizeTrackName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Shown by the session form and returned by `createSession` when no circuit is named. */
export const MISSING_TRACK_MESSAGE =
  'Please enter a track. Sessions are grouped and compared by track, so one saved without it is left out of your history.';

/** Whether a session payload names the circuit it ran at. */
export function hasTrackName(value: string | null | undefined): boolean {
  return normalizeTrackName(value) !== null;
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
 * How many rows a name lookup reads before it stops believing its own answer.
 *
 * A bound is not a detail of the query: a truncated result and an empty one are
 * the same value, and reading the second as "this circuit is new" is what creates
 * the duplicate row. The number is small on purpose - the caller treats reaching
 * it as an unproven answer rather than an absent one, so a bound low enough to
 * hit is better than a high one that hides the same cliff further out.
 */
export const TRACK_NAME_MATCH_LIMIT = 50;

/**
 * PostgREST's alias for `%`, which it substitutes into a `like` value before SQL
 * ever sees it. The substitution is unconditional, so nothing escapes it: `\*`
 * arrives as `\%`, a literal percent sign rather than the asterisk the rider
 * typed. This is the one wildcard neither pattern below can state.
 */
const POSTGREST_WILDCARD_ALIAS = '*';

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
  if (char === '%' || char === '_' || char === '\\' || char === POSTGREST_WILDCARD_ALIAS) return true;
  return char.normalize('NFD') !== char || /\p{M}/u.test(char);
}

/**
 * The typed name as a `like` pattern that matches that name and nothing else.
 *
 * This is the lookup that answers the ordinary case - a rider retyping a circuit
 * they have logged before, stored the way this app stores it - and it answers it
 * precisely, because it carries no wildcard whose breadth could depend on how the
 * name is spelled. `like` folds nothing, so the key does the folding first and
 * `ilike` supplies the case; `%`, `_` and `\` the name itself contains are escaped
 * rather than honoured.
 *
 * `*` is the one that cannot be, so a name carrying one has no exact pattern and
 * means the search pattern instead - the same thing `needsWildcard` already says
 * about it. Escaping it would be worse than having no exact lookup: the caller
 * would run a wildcard query believing it narrow, and a wildcard query that fills
 * `TRACK_NAME_MATCH_LIMIT` is unproven, which is the name-only session this
 * pattern exists to avoid.
 */
export function trackNameExactPattern(value: string | null | undefined): string {
  const key = trackNameKey(value);
  if (!key) return '%';
  if (key.includes(POSTGREST_WILDCARD_ALIAS)) return trackNameSearchPattern(value);

  return key.replace(/[\\%_]/g, '\\$&');
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
 * than the fold. Spacing becomes `%` because the fold collapses runs of it, every
 * character the pattern cannot state literally becomes `%` too, and the whole
 * pattern is open at both ends because the fold trims but a stored row may not
 * have been trimmed. Wider than the fold costs rows the fold then rejects, and
 * `TRACK_NAME_MATCH_LIMIT` decides what happens when there are too many of them;
 * narrower is the duplicate row this exists to prevent, silently.
 */
export function trackNameSearchPattern(value: string | null | undefined): string {
  const key = trackNameKey(value);
  if (!key) return '%';

  let pattern = '%';
  for (const char of key) {
    pattern += char === ' ' || needsWildcard(char) ? '%' : char;
  }

  return `${pattern}%`.replace(/%+/g, '%');
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
