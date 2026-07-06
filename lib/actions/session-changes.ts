'use server';

import { getAuthenticatedUser } from '@/lib/auth';
import { getDemoSessionChanges } from '@/lib/demo/data';
import { isDemoMode } from '@/lib/demo/mode';
import { createClient } from '@/lib/supabase/server';
import type { SessionChange, SessionChangeReferenceKind } from '@/types';

const REFERENCE_KIND_ORDER: Record<SessionChangeReferenceKind, number> = {
  previous: 0,
  baseline: 1,
};

export async function getSessionChangeRecords(sessionId: string): Promise<SessionChange[]> {
  if (await isDemoMode()) {
    return getDemoSessionChanges(sessionId);
  }

  const user = await getAuthenticatedUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from('session_changes')
    .select('*')
    .eq('user_id', user.id)
    .eq('session_id', sessionId);

  return ((data ?? []) as SessionChange[]).sort(
    (a, b) =>
      (REFERENCE_KIND_ORDER[a.reference_kind] ?? 99) - (REFERENCE_KIND_ORDER[b.reference_kind] ?? 99),
  );
}
