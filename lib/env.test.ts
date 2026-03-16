import { afterEach, describe, expect, it } from 'vitest';
import { getRagDailyLimit, getRagRateLimitMaxRequests, isRagEnabled } from '@/lib/env';

describe('rag env helpers', () => {
  const originalRagEnabled = process.env.RAG_ENABLED;
  const originalRagDailyLimit = process.env.RAG_DAILY_LIMIT;
  const originalRateLimit = process.env.RAG_RATE_LIMIT_MAX_REQUESTS;

  afterEach(() => {
    process.env.RAG_ENABLED = originalRagEnabled;
    process.env.RAG_DAILY_LIMIT = originalRagDailyLimit;
    process.env.RAG_RATE_LIMIT_MAX_REQUESTS = originalRateLimit;
  });

  it('defaults RAG to enabled with conservative limits', () => {
    delete process.env.RAG_ENABLED;
    delete process.env.RAG_DAILY_LIMIT;
    delete process.env.RAG_RATE_LIMIT_MAX_REQUESTS;

    expect(isRagEnabled()).toBe(true);
    expect(getRagDailyLimit()).toBe(3);
    expect(getRagRateLimitMaxRequests()).toBe(2);
  });

  it('parses valid env overrides', () => {
    process.env.RAG_ENABLED = 'false';
    process.env.RAG_DAILY_LIMIT = '7';
    process.env.RAG_RATE_LIMIT_MAX_REQUESTS = '4';

    expect(isRagEnabled()).toBe(false);
    expect(getRagDailyLimit()).toBe(7);
    expect(getRagRateLimitMaxRequests()).toBe(4);
  });

  it('rejects invalid daily limit values', () => {
    process.env.RAG_DAILY_LIMIT = '0';
    expect(() => getRagDailyLimit()).toThrow('Invalid RAG_DAILY_LIMIT: expected a positive integer.');

    process.env.RAG_DAILY_LIMIT = '2.5';
    expect(() => getRagDailyLimit()).toThrow('Invalid RAG_DAILY_LIMIT: expected a positive integer.');
  });
});
