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
 * These helpers state what counts as the same circuit. Case, spacing and accent
 * composition are not a different track: `cota` and `COTA` are one, and so are
 * `Barber  Motorsports Park` and `Barber Motorsports Park`. `trackNameKey` is that
 * rule, and every place that compares two track names goes through it.
 *
 * They also state that a session names one at all. Vehicle and Date were both
 * validated while Track was not, so a rider who scrolled past it saved a session
 * that reads "Unknown Track" wherever it is listed and matches no other session
 * at the same circuit. `sessionsMatchTrack` in lib/session-compare.ts pairs two
 * sessions by `track_id` when both carry one, or by `trackNameKey` otherwise, so a
 * trackless session is never a match for anything. It is still offered for
 * comparison - the picker filters on vehicle, not track - but `buildContextFlags`
 * marks every comparison against it with a critical "Track mismatch" and
 * `assignComparisonStrength` calls the result weak. All of it silent at save
 * time. `MISSING_TRACK_MESSAGE` and `hasTrackName` are the rule the form and
 * `createSession` both check, so the two cannot disagree about it.
 */

import { getFreePlanLimitMessage, getFreePlanLimitTitle } from '@/lib/plans';

/** The stored form of a typed track name: trimmed, or null when nothing was typed. */
export function normalizeTrackName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Shown by the session form and returned by `createSession` when no circuit is named. */
export const MISSING_TRACK_MESSAGE =
  'Please enter a track. Sessions are matched to each other by track, so one saved without it reads as "Unknown Track" and every comparison against it is flagged as a track mismatch.';

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

/**
 * Whether a session was logged at a track: it carries the track's id, or it
 * carries no id and names the same circuit.
 *
 * The name half is for sessions saved before `resolveSessionTrack` linked every
 * typed circuit to a row. A session that DOES carry an id belongs to that track
 * only, so a second row sharing the name cannot claim it.
 */
export function sessionIsAtTrack(
  session: { track_id: string | null; track_name: string | null },
  track: { id: string; name: string },
): boolean {
  if (session.track_id) return session.track_id === track.id;
  const key = trackNameKey(session.track_name);
  return key !== '' && key === trackNameKey(track.name);
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

/**
 * What a session's circuit is missing, when the rider has to be told.
 *
 * `missing` is a session that names no circuit at all. `track_limit` is the one
 * that was silent: a free rider already at their custom-track cap types a circuit
 * that is none of their saved tracks, `resolveSessionTrack` cannot add it, and the
 * session keeps the name with `track_id` null - so it is not on their Tracks
 * screen, and `sessionsMatchTrack` pairs it with another session only by that
 * exact name. The save used to succeed without a word about any of it.
 *
 * It is worked out from the tracks and plan it is handed rather than from what
 * happened at save time, which nothing stores: a name no saved track matches, on
 * an account that cannot add one. That is what makes it honest on the session
 * page long after the save - the sentence says what is so, not why it once was.
 * On the form it is a PREDICTION as of page load, not a guarantee: the tracks and
 * cap it is handed are read when the page renders, and `resolveSessionTrack`
 * counts again at Save, so a track added or deleted in another tab, or a plan
 * that changed, can make the two disagree until the page is reloaded. A name-only
 * session with any other cause (an older session, a pro rider whose insert
 * failed) gets no notice here, because this cannot say why.
 */
export type SessionTrackGap =
  | { kind: 'missing' }
  | {
      kind: 'track_limit';
      name: string;
      title: string;
      message: string;
      /** What the form says when it holds back a Save to show `message` first. */
      holdSaveMessage: string;
    };

export function describeSessionTrackGap(params: {
  trackId: string | null;
  trackName: string | null | undefined;
  savedTracks: readonly { name: string }[];
  atTrackLimit: boolean;
}): SessionTrackGap | null {
  const name = normalizeTrackName(params.trackName);
  // Checked before the id, as the session page always did: a row carrying an id
  // and no name still reads "Unknown Track" everywhere it is listed.
  if (!name) return { kind: 'missing' };
  if (params.trackId) return null;
  if (!params.atTrackLimit || findSavedTrackByName(name, params.savedTracks)) return null;

  return {
    kind: 'track_limit',
    name,
    title: getFreePlanLimitTitle('tracks'),
    message: `"${name}" is not one of your saved tracks and cannot be added to them, so this session keeps it as a name only and is matched to other sessions only by that exact name. ${getFreePlanLimitMessage('tracks')}`,
    holdSaveMessage: `Not saved yet: "${name}" is not one of your saved tracks - see the note under Track. Pick one of your saved tracks, or tap Save again to keep the name.`,
  };
}
