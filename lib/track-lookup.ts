import type { createClient } from '@/lib/supabase/server';
import {
  TRACK_NAME_MATCH_LIMIT,
  findSavedTrackByName,
  trackNameExactPattern,
  trackNameSearchPattern,
} from '@/lib/session-track';

/**
 * The tracks a rider can reach: the seeded ones plus their own, which is the list
 * the form's picker offers. Written once because the id lookup and the typed-name
 * search have to ask for the same set - an id resolving in a scope the name search
 * does not use is exactly the id/name divergence `resolveSessionTrack` in lib/actions/sessions.ts closes.
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
 * `findSavedTrackByName` still decides on whatever came back.
 */
export async function findVisibleTrackByName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  typed: string,
): Promise<VisibleTrackLookup> {
  const exact = trackNameExactPattern(typed);
  const wildcard = trackNameSearchPattern(typed);
  const patterns = wildcard === exact ? [exact] : [exact, wildcard];

  for (const pattern of patterns) {
    const { data, error } = await supabase
      .from('tracks')
      .select('id, name')
      .or(visibleTracksFilter(userId))
      .ilike('name', pattern)
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

    const rows = (data ?? []) as { id: string; name: string }[];
    const matched = findSavedTrackByName(typed, rows);
    if (matched) return { status: 'found', track: matched };

    if (rows.length >= TRACK_NAME_MATCH_LIMIT) {
      return {
        status: 'unproven',
        log: '[sessions] visible tracks lookup truncated',
        detail: { userId, trackName: typed, pattern, limit: TRACK_NAME_MATCH_LIMIT },
      };
    }
  }

  return { status: 'absent' };
}
