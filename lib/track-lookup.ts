/**
 * The one track-name resolver: what a picked id, a typed circuit name or an
 * alias means, which of two same-named rows wins, which tracks are the rider's
 * own, and whether they may add another.
 *
 * Each of those rules used to be written more than once - own-track-first three
 * ways, the id/name/alias order twice in the session form alone, the
 * custom-track cap as two database counts and four list counts - so changing
 * any of them meant finding every copy. Each now lives here once, and callers
 * ask rather than restate.
 *
 * What it encodes is CURRENT behaviour, not the rule going forward:
 * docs/adr/0001-what-a-track-is.md decision 8 has the seeded circuit win where
 * the two are the same venue. Not yet rebuilt; the precedence section below is
 * where that change lands.
 *
 * Only `from` is read off a client, so any client acting as the rider will do -
 * the cookie client, a bearer-token client, or a test double - and this module
 * stays free of `@/lib/supabase/server` and the `next/headers` behind it. That
 * is also what lets the session form use the in-memory half.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isAtFreePlanLimit } from '@/lib/plans';
import {
  TRACK_NAME_MATCH_LIMIT,
  findSavedTrackByName,
  trackNameExactPattern,
  trackNameSearchPattern,
  trackNameKey,
} from '@/lib/session-track';
import type { TrackAliasIndex } from '@/lib/track-directory';
import type { Database } from '@/types/supabase';

type TrackQueryClient = Pick<SupabaseClient<Database>, 'from'>;

// ---------------------------------------------------------------------------
// Precedence: the rider's own track before a seeded one.
//
// A rider who logged "Road America" as a custom track before the seed arrived
// sees two rows with that name. Taking whichever came back first would split
// their history across both, so their own row wins, as it does over an alias.
// Superseded by ADR 0001 decision 8 (the seeded circuit wins); this is current
// behaviour, not yet rebuilt.
//
// The rule is stated once, as a rank, and read three ways: in memory
// (`findTrackByName`), as the order a database read comes back in
// (`orderOwnTracksFirst`), and as the point a search can stop early because
// nothing later can outrank what it found (`outranksEveryOtherTrack`).
// ---------------------------------------------------------------------------

/**
 * A track the rider made rather than one seeded for everyone. The seeded ones are
 * shared and read-only; the rest are theirs, and are what the free-plan cap counts.
 */
export function isCustomTrack(track: { is_seeded: boolean }): boolean {
  return !track.is_seeded;
}

/** What the rider reads beside a track of their own in a list. */
export const CUSTOM_TRACK_LABEL = 'Custom';

/** Lower wins. The only place the own-before-seeded order is decided. */
function trackPrecedence(track: { is_seeded: boolean }): number {
  return isCustomTrack(track) ? 0 : 1;
}

/** True when no other track sharing this one's name could be preferred over it. */
export function outranksEveryOtherTrack(track: { is_seeded: boolean }): boolean {
  return trackPrecedence(track) === 0;
}

/**
 * A tracks query ordered by precedence, so a bounded read keeps the rows that
 * would win: `is_seeded` false sorts first, which is `trackPrecedence` in SQL.
 */
function orderOwnTracksFirst<Q extends { order(column: 'is_seeded', options: { ascending: boolean }): Q }>(
  query: Q,
): Q {
  return query.order('is_seeded', { ascending: true });
}

/** The visible track a typed name means, by precedence and then list order. */
export function findTrackByName<T extends { name: string; is_seeded: boolean }>(
  name: string | null | undefined,
  tracks: readonly T[],
): T | null {
  const ranked = [...tracks].sort((a, b) => trackPrecedence(a) - trackPrecedence(b));
  return findSavedTrackByName(name, ranked);
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

// ---------------------------------------------------------------------------
// Resolution order: a picked id, then the name, then an alias.
//
// Names before aliases is the rule, not an optimisation: a rider who made their
// own track called "Barber" means that one, and an alias consulted first would
// send their session to the seeded Barber Motorsports Park instead.
// ---------------------------------------------------------------------------

/**
 * What to do with a picked id that is not in the list being resolved against.
 *
 * `keep` trusts it: the form's layout picker has always keyed on the id it was
 * handed. `ignore` drops it and resolves the typed text instead, which is what
 * `createSession` does with an id it cannot see - so the form's track-cap
 * prediction judges the name the save will actually resolve. The two differ only
 * for a stale id (a copied setup or restored draft whose track was deleted), and
 * unifying them would change which layouts that rider is offered, so the
 * difference is kept and named rather than folded away.
 */
export type UnlistedTrackId = 'keep' | 'ignore';

/** The track a picked id or typed text names within a list already in memory. */
export function resolveTrackInDirectory<T extends { id: string; name: string; is_seeded: boolean }>(params: {
  trackId: string | null | undefined;
  typed: string | null | undefined;
  tracks: readonly T[];
  aliases: TrackAliasIndex;
  unlistedId: UnlistedTrackId;
}): string | null {
  const { trackId, typed, tracks, aliases } = params;
  if (trackId && (params.unlistedId === 'keep' || tracks.some((track) => track.id === trackId))) {
    return trackId;
  }
  return findTrackByName(typed, tracks)?.id ?? findTrackByAlias(typed, aliases, tracks)?.id ?? null;
}

/**
 * The tracks a rider can reach: the seeded ones plus their own, which is the list
 * the form's picker offers. Written once because the id lookup and the typed-name
 * search have to ask for the same set - an id resolving in a scope the name search
 * does not use is exactly the id/name divergence `resolveSessionTrack` in lib/sessions/create.ts closes.
 */
export function visibleTracksFilter(userId: string): string {
  return `is_seeded.eq.true,created_by.eq.${userId}`;
}

/**
 * What a name lookup found, including the case where it cannot say.
 *
 * `unproven` is the one that matters. A read that failed, and a read that came
 * back full, both leave the question open - and the caller's next move on an open
 * question must not be the insert, because a circuit the rider already has would
 * get a second row and spend one of a free rider's three slots.
 */
export type VisibleTrackLookup =
  | { status: 'found'; track: { id: string; name: string } }
  | { status: 'absent' }
  | { status: 'unproven'; log: string; detail: Record<string, unknown> };

/**
 * The saved track a typed name means, looked for in the database rather than read
 * whole and folded here - the name and then the alias steps of the order above.
 *
 * Two queries, narrowest first. The exact pattern answers a rider retyping a
 * circuit they have logged before and cannot be widened by how the name is
 * spelled, so the ordinary case never depends on the bound at all. Only when that
 * misses does the wildcard pattern go looking for the spellings the fold accepts
 * but `like` does not - doubled spacing, a decomposed accent, a stored row that
 * was never trimmed - and that pattern can be broad enough to match a great many
 * rows.
 *
 * Which is why reaching the limit is `unproven` and not `absent`. The rows come
 * back ordered so the same request cannot answer differently twice, and
 * `findTrackByName` still decides on whatever came back.
 */
export async function findVisibleTrackByName(
  supabase: TrackQueryClient,
  userId: string,
  typed: string,
): Promise<VisibleTrackLookup> {
  const exact = trackNameExactPattern(typed);
  const wildcard = trackNameSearchPattern(typed);
  const patterns = wildcard === exact ? [exact] : [exact, wildcard];
  let outranked: { id: string; name: string } | null = null;

  for (const pattern of patterns) {
    const { data, error } = await orderOwnTracksFirst(
      supabase
        .from('tracks')
        .select('id, name, is_seeded')
        .or(visibleTracksFilter(userId))
        .ilike('name', pattern),
    )
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .limit(TRACK_NAME_MATCH_LIMIT);

    if (error) {
      return {
        status: 'unproven',
        log: '[sessions] visible tracks lookup failed',
        detail: { userId, error: error.message },
      };
    }

    const rows = (data ?? []) as { id: string; name: string; is_seeded: boolean }[];
    const matched = findTrackByName(typed, rows);
    if (matched && outranksEveryOtherTrack(matched)) {
      return { status: 'found', track: { id: matched.id, name: matched.name } };
    }
    // A match a later, wider pattern could still outrank: keep the first one and
    // look on.
    if (matched) outranked ??= { id: matched.id, name: matched.name };

    if (rows.length >= TRACK_NAME_MATCH_LIMIT) {
      return {
        status: 'unproven',
        log: '[sessions] visible tracks lookup truncated',
        detail: { userId, trackName: typed, pattern, limit: TRACK_NAME_MATCH_LIMIT },
      };
    }
  }

  if (outranked) return { status: 'found', track: outranked };

  // Only now the other names the circuit is known by - see the resolution order.
  return findVisibleTrackByAlias(supabase, userId, typed);
}

/**
 * The circuit an alias names, under the same bound and the same three answers as
 * the name lookup above.
 *
 * The two patterns and the `unproven` reading are deliberately identical,
 * because the consequence of getting it wrong is identical: a truncated read
 * that answers "absent" creates a second row for a circuit the rider already
 * has. The alias table is small today, and a bound that is never reached is
 * exactly the kind that is quietly wrong later.
 */
async function findVisibleTrackByAlias(
  supabase: TrackQueryClient,
  userId: string,
  typed: string,
): Promise<VisibleTrackLookup> {
  const exact = trackNameExactPattern(typed);
  const wildcard = trackNameSearchPattern(typed);
  const patterns = wildcard === exact ? [exact] : [exact, wildcard];

  for (const pattern of patterns) {
    const { data, error } = await supabase
      .from('track_aliases')
      .select('alias, tracks!inner(id, name)')
      .ilike('alias', pattern)
      .order('alias', { ascending: true })
      .limit(TRACK_NAME_MATCH_LIMIT);

    if (error) {
      return {
        status: 'unproven',
        log: '[sessions] track alias lookup failed',
        detail: { userId, error: error.message },
      };
    }

    const rows = (data ?? []) as { alias: string; tracks: { id: string; name: string } }[];
    // Folded on `alias`, then answered with the TRACK's own name - the alias is
    // how the rider found the circuit, not what the circuit is called.
    const matched = findSavedTrackByName(
      typed,
      rows.map((row) => ({ name: row.alias, track: row.tracks })),
    );
    if (matched) return { status: 'found', track: matched.track };

    if (rows.length >= TRACK_NAME_MATCH_LIMIT) {
      return {
        status: 'unproven',
        log: '[sessions] track alias lookup truncated',
        detail: { userId, trackName: typed, pattern, limit: TRACK_NAME_MATCH_LIMIT },
      };
    }
  }

  return { status: 'absent' };
}

// ---------------------------------------------------------------------------
// The custom-track cap: how many tracks of their own a free rider may keep.
// ---------------------------------------------------------------------------

/**
 * Whether the rider can add no more tracks, counted from a list of the tracks
 * they can see - the seeded ones plus their own, so the custom ones in it are
 * exactly the ones the cap counts. A screen's answer as of page load; the write
 * paths count again with `isAtCustomTrackCapInDatabase`.
 */
export function isAtCustomTrackCap(tracks: readonly { is_seeded: boolean }[], hasProAccess: boolean): boolean {
  return isAtFreePlanLimit('tracks', tracks.filter(isCustomTrack).length, hasProAccess);
}

/**
 * The same question asked of the database, just before a track row would be
 * inserted. A pro rider is never counted. A count the read could not give reads
 * as zero - not at the cap - which is how both write paths have always treated it.
 */
export async function isAtCustomTrackCapInDatabase(
  supabase: TrackQueryClient,
  userId: string,
  hasProAccess: boolean,
): Promise<boolean> {
  if (hasProAccess) return false;

  const { count } = await supabase
    .from('tracks')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', userId)
    .eq('is_seeded', false);

  return isAtFreePlanLimit('tracks', count ?? 0, hasProAccess);
}
