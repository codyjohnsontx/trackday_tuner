import { getRagRateLimitMaxRequests, getRagRateLimitWindowMs } from '@/lib/env';

interface RagRateLimitWindow {
  count: number;
  resetAt: number;
}

export interface RagRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

const windows = new Map<string, RagRateLimitWindow>();

function pruneExpiredWindows(now: number) {
  for (const [key, value] of windows.entries()) {
    if (value.resetAt <= now) {
      windows.delete(key);
    }
  }
}

export function consumeRagRateLimit(
  userId: string,
  now = Date.now(),
): RagRateLimitResult {
  pruneExpiredWindows(now);

  const limit = getRagRateLimitMaxRequests();
  const windowMs = getRagRateLimitWindowMs();
  const current = windows.get(userId);

  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    windows.set(userId, { count: 1, resetAt });
    return {
      allowed: true,
      limit,
      remaining: Math.max(limit - 1, 0),
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfterSeconds: Math.max(Math.ceil((current.resetAt - now) / 1000), 1),
    };
  }

  current.count += 1;
  windows.set(userId, current);

  return {
    allowed: true,
    limit,
    remaining: Math.max(limit - current.count, 0),
    resetAt: current.resetAt,
    retryAfterSeconds: 0,
  };
}

export function resetRagRateLimitWindows() {
  windows.clear();
}
