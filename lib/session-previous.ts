import { compareSessionsDesc, isSessionBefore } from '@/lib/session-compare';
import type { Database } from '@/types/supabase';
import type { Session } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// How many same-vehicle rows to pull before picking the immediate predecessor in
// TypeScript. Rows are fetched newest-first, so the only ones that can be "wasted"
// are same-date sessions that sort after the current one — far fewer than this on
// any real track day. `fetchPreviousSession` still falls back to an exact
// earlier-date query if the window ever fills up, so this is a round-trip
// optimisation, not a correctness assumption.
export const PREVIOUS_SESSION_SCAN_LIMIT = 50;

type SessionQueryClient = Pick<SupabaseClient<Database>, 'from'>;

interface PreviousSessionQuery {
  supabase: SessionQueryClient;
  userId: string;
  currentSession: Session;
}

function baseQuery({ supabase, userId, currentSession }: PreviousSessionQuery) {
  // Mirrors compareSessionsDesc: date, then start_time with NULL treated as the
  // earliest time of the day (so "nulls last" in a descending sort), then created_at.
  return supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('vehicle_id', currentSession.vehicle_id)
    .neq('id', currentSession.id)
    .order('date', { ascending: false })
    .order('start_time', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
}

/**
 * The session immediately before `currentSession` for the same vehicle, or null.
 *
 * "Before" is defined once, in `isSessionBefore`: date, then `start_time` coalesced
 * to `00:00:00`, then `created_at`, then `id`. Start Time is optional, so a raw
 * PostgREST `start_time.lt.<t>` predicate silently drops every earlier session that
 * has none — `NULL < '23:59:59'` is NULL, not true. That hid same-day comparisons
 * and change tracking from every rider who skipped the field. So the ordering is
 * pushed into SQL only as far as it can go safely, and the strict "is this actually
 * earlier?" test stays in the shared helper the demo path already uses.
 */
export async function fetchPreviousSession(
  supabase: SessionQueryClient,
  userId: string,
  currentSession: Session,
): Promise<Session | null> {
  const query = { supabase, userId, currentSession };

  const { data, error } = await baseQuery(query)
    .lte('date', currentSession.date)
    .limit(PREVIOUS_SESSION_SCAN_LIMIT);

  if (error) return null;

  const rows = (data ?? []) as Session[];
  const previous = rows
    .filter((candidate) => isSessionBefore(candidate, currentSession))
    .sort(compareSessionsDesc)[0];

  if (previous) return previous;

  // Nothing in the window was earlier. That is the real answer unless the window
  // filled up entirely with same-date sessions that sort after this one — any row
  // from an earlier date would have matched. In that case, ask for the newest
  // earlier date directly.
  if (rows.length < PREVIOUS_SESSION_SCAN_LIMIT) return null;

  const { data: earlierData } = await baseQuery(query).lt('date', currentSession.date).limit(1);

  return ((earlierData ?? [])[0] ?? null) as Session | null;
}
