import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock('@/lib/rag/daily-limit', () => ({
  consumeRagDailyLimit: vi.fn(async () => ({
    allowed: true,
    limit: 3,
    used: 1,
    remaining: 2,
    resetAt: Date.now() + 86_400_000,
    retryAfterSeconds: 0,
  })),
}));

vi.mock('@/lib/rag/query', () => ({
  RagIndexMissingError: class RagIndexMissingError extends Error {},
  RagValidationError: class RagValidationError extends Error {},
  runRagQuery: vi.fn(),
  validateRagQueryRequest: vi.fn((input) => input),
}));

vi.mock('@/lib/rag/rate-limit', () => ({
  consumeRagRateLimit: vi.fn(() => ({
    allowed: true,
    limit: 5,
    remaining: 4,
    resetAt: Date.now() + 60_000,
    retryAfterSeconds: 0,
  })),
}));

import { POST } from '@/app/api/rag/query/route';
import { getAuthenticatedUser } from '@/lib/auth';
import { consumeRagDailyLimit } from '@/lib/rag/daily-limit';
import { OpenAIRagProviderError } from '@/lib/rag/openai-provider';
import { RagIndexMissingError, runRagQuery } from '@/lib/rag/query';
import { consumeRagRateLimit } from '@/lib/rag/rate-limit';

describe('POST /api/rag/query', () => {
  const originalRagEnabled = process.env.RAG_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RAG_ENABLED = 'true';
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(consumeRagRateLimit).mockReturnValue({
      allowed: true,
      limit: 5,
      remaining: 4,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 0,
    });
    vi.mocked(consumeRagDailyLimit).mockResolvedValue({
      allowed: true,
      limit: 3,
      used: 1,
      remaining: 2,
      resetAt: Date.now() + 86_400_000,
      retryAfterSeconds: 0,
    });
  });

  afterAll(() => {
    process.env.RAG_ENABLED = originalRagEnabled;
  });

  it('returns 503 when AI is disabled', async () => {
    process.env.RAG_ENABLED = 'false';

    const response = await POST(
      new Request('http://127.0.0.1:3000/api/rag/query', {
        method: 'POST',
        body: JSON.stringify({ question: 'What does rider sag mean?' }),
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'AI Q&A is temporarily disabled.' });
  });

  it('returns 401 for unauthenticated requests', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    const response = await POST(
      new Request('http://127.0.0.1:3000/api/rag/query', {
        method: 'POST',
        body: JSON.stringify({ question: 'What does rider sag mean?' }),
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Not authenticated.' });
  });

  it('returns 400 for invalid json', async () => {
    const response = await POST(
      new Request('http://127.0.0.1:3000/api/rag/query', {
        method: 'POST',
        body: '{invalid',
        headers: { 'content-type': 'application/json' },
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Request body must be valid JSON.' });
  });

  it('returns 400 for validation errors', async () => {
    const response = await POST(
      new Request('http://127.0.0.1:3000/api/rag/query', {
        method: 'POST',
        body: JSON.stringify({ question: 'short' }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Question must be at least 8 characters.' });
    expect(runRagQuery).not.toHaveBeenCalled();
  });

  it('returns 429 when the caller is rate limited', async () => {
    vi.mocked(consumeRagRateLimit).mockReturnValue({
      allowed: false,
      limit: 5,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      retryAfterSeconds: 30,
    });

    const response = await POST(
      new Request('http://127.0.0.1:3000/api/rag/query', {
        method: 'POST',
        body: JSON.stringify({ question: 'What does rider sag mean?' }),
      })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
    await expect(response.json()).resolves.toEqual({
      error: 'Rate limit exceeded. Try again in 30 seconds.',
      retry_after_seconds: 30,
    });
  });

  it('returns 429 when the caller exceeds the daily limit', async () => {
    vi.mocked(consumeRagDailyLimit).mockResolvedValue({
      allowed: false,
      limit: 3,
      used: 3,
      remaining: 0,
      resetAt: Date.now() + 3_600_000,
      retryAfterSeconds: 3600,
    });

    const response = await POST(
      new Request('http://127.0.0.1:3000/api/rag/query', {
        method: 'POST',
        body: JSON.stringify({ question: 'What does rider sag mean?' }),
      })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3600');
    await expect(response.json()).resolves.toEqual({
      error: 'Daily AI question limit reached. Try again tomorrow.',
      retry_after_seconds: 3600,
      limit: 3,
      remaining: 0,
    });
  });

  it('returns 503 when index is missing', async () => {
    vi.mocked(runRagQuery).mockRejectedValue(new RagIndexMissingError('RAG index not built. Run npm run rag:index.'));

    const response = await POST(
      new Request('http://127.0.0.1:3000/api/rag/query', {
        method: 'POST',
        body: JSON.stringify({ question: 'What does rider sag mean?' }),
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'RAG index not built. Run npm run rag:index.' });
  });

  it('returns 503 when the provider is unavailable', async () => {
    vi.mocked(runRagQuery).mockRejectedValue(
      new OpenAIRagProviderError('AI service is currently unavailable.', {
        phase: 'embedding',
        statusCode: 429,
        providerCode: 'insufficient_quota',
      })
    );

    const response = await POST(
      new Request('http://127.0.0.1:3000/api/rag/query', {
        method: 'POST',
        body: JSON.stringify({ question: 'What does rider sag mean?' }),
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'AI service is currently unavailable.' });
  });

  it('returns answer and citations on success', async () => {
    vi.mocked(runRagQuery).mockResolvedValue({
      answer: 'Rider sag is L0 minus L2.',
      citations: [
        {
          source_type: 'knowledge_base',
          source_id: 'sag-basics',
          title: 'Sag Basics',
          snippet: 'Rider sag is L0 minus L2.',
          score: 0.91,
        },
      ],
      missing_info: [],
    });

    const response = await POST(
      new Request('http://127.0.0.1:3000/api/rag/query', {
        method: 'POST',
        body: JSON.stringify({ question: 'What does rider sag mean?' }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      answer: 'Rider sag is L0 minus L2.',
      citations: [
        {
          source_type: 'knowledge_base',
          source_id: 'sag-basics',
          title: 'Sag Basics',
          snippet: 'Rider sag is L0 minus L2.',
          score: 0.91,
        },
      ],
      missing_info: [],
    });
  });
});
