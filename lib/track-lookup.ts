import type { SupabaseClient } from '@supabase/supabase-js';
import {
  TRACK_NAME_MATCH_LIMIT,
  findSavedTrackByName,
  trackNameExactPattern,
  trackNameSearchPattern,
} from '@/lib/session-track';
import { findTrackByName } from '@/lib/track-directory';
import type { Database } from '@/types/supabase';

/**
 * Only `from` is read, so any client acting as the rider will do - the cookie
 * client, a bearer-token client, or a test double - and this module stays free of
 * `@/lib/supabase/server` and the `next/headers` behind it.
 */
type TrackQueryClient = Pick<SupabaseClient<Database>, 'from'>;

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
 * whole and folded here.
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
  let seeded: { id: string; name: string } | null = null;

  for (const pattern of patterns) {
    const { data, error } = await supabase
      .from('tracks')
      .select('id, name, is_seeded')
      .or(visibleTracksFilter(userId))
      .ilike('name', pattern)
      .order('is_seeded', { ascending: true })
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
    if (matched && !matched.is_seeded) {
      return { status: 'found', track: { id: matched.id, name: matched.name } };
    }
    if (matched) seeded ??= { id: matched.id, name: matched.name };

    if (rows.length >= TRACK_NAME_MATCH_LIMIT) {
      return {
        status: 'unproven',
        log: '[sessions] visible tracks lookup truncated',
        detail: { userId, trackName: typed, pattern, limit: TRACK_NAME_MATCH_LIMIT },
      };
    }
  }

  if (seeded) return { status: 'found', track: seeded };

  // Only now the other names the circuit is known by. Names first is the rule,
  // not an optimisation: a rider who made their own track called "Barber" means
  // that one, and an alias consulted first would send their session to the
  // seeded Barber Motorsports Park instead. See lib/track-directory.ts.
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
