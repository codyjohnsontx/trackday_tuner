'use server';

import { getAuthenticatedUser } from '@/lib/auth';
import { isDemoMode } from '@/lib/demo/mode';
import { createClient } from '@/lib/supabase/server';
import type { BetaFeedback } from '@/types';

export async function getBetaFeedback(): Promise<BetaFeedback | null> {
  if (await isDemoMode()) return null;
  const user = await getAuthenticatedUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.from('beta_feedback').select('*').eq('user_id', user.id).maybeSingle();
  return (data as BetaFeedback | null) ?? null;
}

export async function hasTwoDistinctTrackDays(): Promise<boolean> {
  if (await isDemoMode()) return false;
  const user = await getAuthenticatedUser();
  if (!user) return false;
  const supabase = await createClient();
  const { data } = await supabase.from('sessions').select('date').eq('user_id', user.id).order('date', { ascending: false }).limit(100);
  return new Set((data ?? []).map((row) => row.date)).size >= 2;
}
