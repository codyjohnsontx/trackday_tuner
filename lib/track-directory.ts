/**
 * The circuits a rider can name, and what a name they typed actually means.
 *
 * lib/session-track.ts folds a name: case, spacing, accent composition. That is
 * as far as spelling can take you, and it is not far enough. "Circuit of the
 * Americas" in April and "COTA" in May fold to two different keys, so before
 * this file they were two circuits, two of a free rider's three custom-track
 * slots, and a season that grouped under neither.
 *
 * Identity is the fix, and it is data rather than cleverness: a seeded circuit
 * carries the other names it is known by (`track_aliases`), and a typed name is
 * looked up against those as well as against the names themselves. No edit
 * distance, deliberately - "Road America" and "Road Atlanta" are four edits
 * apart and are two circuits eight hundred miles from each other, so a matcher
 * that tolerates four edits files a rider's Wisconsin weekend in Georgia. What
 * a curated alias buys is being right about the variants riders actually type;
 * what it cannot do is catch a typo nobody wrote down, and that is the accepted
 * limit of this approach.
 *
 * The lookup order is names first, then aliases, and that order is the rule that
 * matters: a rider who has made their own track called "Barber" means THAT one,
 * not the seeded Barber Motorsports Park an alias would otherwise redirect them
 * to. Their own naming wins.
 */
import { findSavedTrackByName, trackNameKey } from '@/lib/session-track';
import type { Track, TrackAlias, TrackLayout } from '@/types';

/** A circuit's alternate spellings, keyed the way `trackNameKey` keys a name. */
export type TrackAliasIndex = Record<string, string>;

/** The layouts of one circuit, in the order they should be offered. */
export type TrackLayoutIndex = Record<string, TrackLayout[]>;

/**
 * Everything the New Session form needs to turn typing into a circuit.
 *
 * The form resolves with the same data the server resolves with, so what the
 * typeahead offers and what `createSession` stores cannot disagree. Shipping it
 * is cheap - the whole seeded set is fifty circuits - and the alternative, a
 * round trip per keystroke, would put the rider's most-used field behind the
 * network.
 */
export interface TrackDirectory {
  tracks: Track[];
  aliases: TrackAliasIndex;
  layouts: TrackLayoutIndex;
}

/**
 * Alias rows as a lookup, dropping any whose key repeats.
 *
 * The database refuses an ambiguous alias with a unique index over the same
 * fold, so a repeat here means the two sides disagree about what folding is.
 * Dropping both rather than letting the last row win is the fail-safe direction:
 * an alias that resolves to whichever row came back first is worse than one that
 * resolves to nothing, because the rider cannot see which it picked.
 */
export function buildTrackAliasIndex(rows: readonly TrackAlias[]): TrackAliasIndex {
  const seen = new Map<string, string | null>();

  for (const row of rows) {
    const key = trackNameKey(row.alias);
    if (!key) continue;
    if (seen.has(key)) {
      if (seen.get(key) !== row.track_id) seen.set(key, null);
      continue;
    }
    seen.set(key, row.track_id);
  }

  const index: TrackAliasIndex = {};
  for (const [key, trackId] of seen) {
    if (trackId) index[key] = trackId;
  }
  return index;
}

/** Layout rows grouped by circuit, each group in `sort_order`. */
export function buildTrackLayoutIndex(rows: readonly TrackLayout[]): TrackLayoutIndex {
  const index: TrackLayoutIndex = {};

  for (const row of rows) {
    (index[row.track_id] ??= []).push(row);
  }
  for (const group of Object.values(index)) {
    group.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }

  return index;
}

/**
 * The visible track a typed name means, the rider's own before a seeded one.
 *
 * A rider who logged "Road America" as a custom track before the seed arrived
 * now sees two rows with that name. Taking whichever came back first would split
 * their history across both, so their own row wins, as it does over an alias.
 */
export function findTrackByName<T extends { name: string; is_seeded: boolean }>(
  name: string | null | undefined,
  tracks: readonly T[],
): T | null {
  return (
    findSavedTrackByName(
      name,
      tracks.filter((track) => !track.is_seeded),
    ) ?? findSavedTrackByName(name, tracks)
  );
}

/** The circuit an alias names, or null when the name is not one. */
export function findTrackByAlias<T extends { id: string }>(
  name: string | null | undefined,
  aliases: TrackAliasIndex,
  tracks: readonly T[],
): T | null {
  const key = trackNameKey(name);
  if (!key) return null;

  const trackId = aliases[key];
  if (!trackId) return null;

  return tracks.find((track) => track.id === trackId) ?? null;
}

/**
 * Whether a circuit's list of layouts offers this one.
 *
 * A layout belongs to exactly one track, so a layout id that came from a
 * different circuit is not a narrower answer - it is a session that says it ran
 * a configuration the track does not have. The caller drops it rather than
 * storing it.
 */
export function findLayoutForTrack(
  layoutId: string | null | undefined,
  trackId: string | null | undefined,
  layouts: TrackLayoutIndex,
): TrackLayout | null {
  if (!layoutId || !trackId) return null;
  return layouts[trackId]?.find((layout) => layout.id === layoutId) ?? null;
}
