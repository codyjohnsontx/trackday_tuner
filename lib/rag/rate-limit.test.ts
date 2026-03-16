import { afterEach, describe, expect, it } from 'vitest';
import { resetRagRateLimitWindows, consumeRagRateLimit } from '@/lib/rag/rate-limit';

describe('consumeRagRateLimit', () => {
  afterEach(() => {
    resetRagRateLimitWindows();
    delete process.env.RAG_RATE_LIMIT_MAX_REQUESTS;
    delete process.env.RAG_RATE_LIMIT_WINDOW_MS;
  });

  it('allows requests until the configured limit is hit', () => {
    process.env.RAG_RATE_LIMIT_MAX_REQUESTS = '2';
    process.env.RAG_RATE_LIMIT_WINDOW_MS = '60000';

    const first = consumeRagRateLimit('user-1', 1_000);
    const second = consumeRagRateLimit('user-1', 2_000);
    const third = consumeRagRateLimit('user-1', 3_000);

    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets the window after it expires', () => {
    process.env.RAG_RATE_LIMIT_MAX_REQUESTS = '1';
    process.env.RAG_RATE_LIMIT_WINDOW_MS = '1000';

    const first = consumeRagRateLimit('user-1', 1_000);
    const second = consumeRagRateLimit('user-1', 2_500);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
  });
});
