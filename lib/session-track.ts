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

/** The saved track a typed name means, or null when the rider is naming a new one. */
export function findSavedTrackByName<T extends { name: string }>(
  name: string | null | undefined,
  tracks: readonly T[],
): T | null {
  const key = trackNameKey(name);
  if (!key) return null;

  return tracks.find((track) => trackNameKey(track.name) === key) ?? null;
}
