import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();

vi.mock('@/lib/env', () => ({
  getRagDailyLimit: vi.fn(() => 3),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ rpc })),
}));

import { consumeRagDailyLimit } from '@/lib/rag/daily-limit';

describe('consumeRagDailyLimit', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('allows the first request and returns remaining usage', async () => {
    rpc.mockResolvedValue({
      data: [{ allowed: true, request_count: 1 }],
      error: null,
    });

    const result = await consumeRagDailyLimit('user-1', Date.parse('2026-03-14T10:00:00.000Z'));

    expect(rpc).toHaveBeenCalledWith('consume_rag_daily_limit', {
      p_user_id: 'user-1',
      p_usage_date: '2026-03-14',
      p_limit: 3,
    });
    expect(result).toMatchObject({
      allowed: true,
      limit: 3,
      used: 1,
      remaining: 2,
      retryAfterSeconds: 0,
    });
  });

  it('rejects requests after the daily cap is reached', async () => {
    rpc.mockResolvedValue({
      data: [{ allowed: false, request_count: 3 }],
      error: null,
    });

    const result = await consumeRagDailyLimit('user-1', Date.parse('2026-03-14T23:00:00.000Z'));

    expect(result.allowed).toBe(false);
    expect(result.used).toBe(3);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets usage on the next UTC day', async () => {
    rpc.mockResolvedValue({
      data: [{ allowed: true, request_count: 1 }],
      error: null,
    });

    const result = await consumeRagDailyLimit('user-1', Date.parse('2026-03-15T00:00:01.000Z'));

    expect(rpc).toHaveBeenCalledWith('consume_rag_daily_limit', {
      p_user_id: 'user-1',
      p_usage_date: '2026-03-15',
      p_limit: 3,
    });
    expect(result.used).toBe(1);
  });
});
