'use server';

import { getRealUser } from '@/lib/auth';
import { getDemoSessionChanges } from '@/lib/demo/data';
import { isDemoMode } from '@/lib/demo/mode';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult, SessionChange, SessionChangeReferenceKind } from '@/types';

const REFERENCE_KIND_ORDER: Record<SessionChangeReferenceKind, number> = {
  previous: 0,
  baseline: 1,
};

/**
 * A session's change history. A failed read is reported rather than returned
 * as `[]`, which the session delete confirmation would read as "no change
 * history to lose".
 */
export async function getSessionChangeRecords(sessionId: string): Promise<ActionResult<SessionChange[]>> {
  if (await isDemoMode()) {
    return { ok: true, data: getDemoSessionChanges(sessionId) };
  }

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('session_changes')
    .select('*')
    .eq('user_id', user.id)
    .eq('session_id', sessionId);

  if (error) {
    console.error('[session-changes] change-records query failed', { userId: user.id, sessionId, error: error.message });
    return { ok: false, error: error.message };
  }

  const records = ((data ?? []) as SessionChange[]).sort(
    (a, b) =>
      (REFERENCE_KIND_ORDER[a.reference_kind] ?? 99) - (REFERENCE_KIND_ORDER[b.reference_kind] ?? 99),
  );
  return { ok: true, data: records };
}
