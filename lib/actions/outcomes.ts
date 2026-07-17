'use server';

import { getAuthenticatedUser } from '@/lib/auth';
import { isDemoMode } from '@/lib/demo/mode';
import { createClient } from '@/lib/supabase/server';
import type { AiRecommendation, SessionFeedback } from '@/types';

export async function getSessionOutcome(sessionId: string): Promise<SessionFeedback | null> {
  if (await isDemoMode()) return null;
  const user = await getAuthenticatedUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from('session_feedback')
    .select('*')
    .eq('user_id', user.id)
    .eq('session_id', sessionId)
    .maybeSingle();
  return (data as SessionFeedback | null) ?? null;
}

export async function getVehicleOutcomeHistory(vehicleId: string, limit = 5): Promise<SessionFeedback[]> {
  if (await isDemoMode()) return [];
  const user = await getAuthenticatedUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('session_feedback')
    .select('*')
    .eq('user_id', user.id)
    .eq('vehicle_id', vehicleId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as SessionFeedback[];
}

export async function getOutstandingRecommendations(params: {
  vehicleId: string;
  beforeSessionId: string;
  beforeDate: string;
}): Promise<AiRecommendation[]> {
  if (await isDemoMode()) return [];
  const user = await getAuthenticatedUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('ai_recommendations')
    .select('*')
    .eq('user_id', user.id)
    .eq('vehicle_id', params.vehicleId)
    .eq('status', 'proposed')
    .neq('session_id', params.beforeSessionId)
    .lte('created_at', `${params.beforeDate}T23:59:59.999Z`)
    .order('created_at', { ascending: false })
    .limit(8);
  return (data ?? []) as AiRecommendation[];
}
