'use server';

import { getAuthenticatedUser } from '@/lib/auth';
import { isDemoMode } from '@/lib/demo/mode';
import { filterRecommendationsBeforeSession } from '@/lib/recommendation-ordering';
import { createClient } from '@/lib/supabase/server';
import type { AiRecommendation, Session, SessionFeedback } from '@/types';

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
}): Promise<AiRecommendation[]> {
  if (await isDemoMode()) return [];
  const user = await getAuthenticatedUser();
  if (!user) return [];
  const supabase = await createClient();
  const [targetResult, recommendationResult] = await Promise.all([
    supabase
      .from('sessions')
      .select('*')
      .eq('id', params.beforeSessionId)
      .eq('user_id', user.id)
      .eq('vehicle_id', params.vehicleId)
      .maybeSingle(),
    supabase
    .from('ai_recommendations')
    .select('*')
    .eq('user_id', user.id)
    .eq('vehicle_id', params.vehicleId)
    .eq('status', 'proposed')
    .neq('session_id', params.beforeSessionId)
    .order('created_at', { ascending: false }),
  ]);
  if (targetResult.error || recommendationResult.error || !targetResult.data) return [];

  const recommendations = (recommendationResult.data ?? []) as AiRecommendation[];
  const sourceSessionIds = recommendations.flatMap((recommendation) =>
    recommendation.session_id ? [recommendation.session_id] : [],
  );
  if (sourceSessionIds.length === 0) return [];

  const { data: sourceRows, error: sourceError } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .eq('vehicle_id', params.vehicleId)
    .in('id', sourceSessionIds);
  if (sourceError) return [];

  const targetSession = targetResult.data as Session;
  return filterRecommendationsBeforeSession(
    recommendations,
    (sourceRows ?? []) as Session[],
    targetSession,
  );
}
