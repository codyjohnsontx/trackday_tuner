import { getRagDailyLimit } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

export interface RagDailyLimitResult {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

interface ConsumeRagDailyLimitRow {
  allowed: boolean;
  request_count: number;
}

function getUtcUsageDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function getUtcResetAt(now: number): number {
  const currentDate = getUtcUsageDate(now);
  return Date.parse(`${currentDate}T00:00:00.000Z`) + 86_400_000;
}

export async function consumeRagDailyLimit(
  userId: string,
  now = Date.now(),
): Promise<RagDailyLimitResult> {
  const limit = getRagDailyLimit();
  const usageDate = getUtcUsageDate(now);
  const resetAt = getUtcResetAt(now);
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('consume_rag_daily_limit', {
    p_user_id: userId,
    p_usage_date: usageDate,
    p_limit: limit,
  });

  if (error) {
    throw error;
  }

  const row = (Array.isArray(data) ? data[0] : data) as ConsumeRagDailyLimitRow | null;
  if (!row) {
    throw new Error('consume_rag_daily_limit returned no data.');
  }

  return {
    allowed: row.allowed,
    limit,
    used: row.request_count,
    remaining: Math.max(limit - row.request_count, 0),
    resetAt,
    retryAfterSeconds: row.allowed ? 0 : Math.max(Math.ceil((resetAt - now) / 1000), 1),
  };
}
