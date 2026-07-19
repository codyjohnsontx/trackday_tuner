import { isSessionBefore } from '@/lib/session-compare';
import type { AiRecommendation, Session } from '@/types';

export function filterRecommendationsBeforeSession(
  recommendations: AiRecommendation[],
  sourceSessions: Session[],
  targetSession: Session,
  limit = 8,
): AiRecommendation[] {
  const sourceById = new Map(sourceSessions.map((session) => [session.id, session]));
  return recommendations.filter((recommendation) => {
    const source = recommendation.session_id
      ? sourceById.get(recommendation.session_id)
      : undefined;
    return Boolean(source && isSessionBefore(source, targetSession));
  }).slice(0, limit);
}
