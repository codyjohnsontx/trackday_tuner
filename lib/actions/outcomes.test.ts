import { describe, expect, it } from 'vitest';
import { filterRecommendationsBeforeSession } from '@/lib/recommendation-ordering';
import type { AiRecommendation, Session } from '@/types';

function session(id: string, startTime: string, createdAt: string): Session {
  return {
    id,
    date: '2026-07-18',
    start_time: startTime,
    created_at: createdAt,
  } as Session;
}

function recommendation(id: string, sessionId: string): AiRecommendation {
  return { id, session_id: sessionId } as AiRecommendation;
}

describe('filterRecommendationsBeforeSession', () => {
  it('uses source-session ordering for recommendations created around the same date', () => {
    const target = session('target', '10:00:00', '2026-07-18T10:00:10.000Z');
    const before = session('before', '09:30:00', '2026-07-18T09:30:10.000Z');
    const after = session('after', '10:30:00', '2026-07-18T10:30:10.000Z');

    const result = filterRecommendationsBeforeSession(
      [recommendation('from-after', after.id), recommendation('from-before', before.id)],
      [after, before],
      target,
    );

    expect(result.map((item) => item.id)).toEqual(['from-before']);
  });
});
