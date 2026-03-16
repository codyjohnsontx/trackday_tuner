import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { isRagEnabled } from '@/lib/env';
import { logError, logInfo, logWarn } from '@/lib/observability';
import { consumeRagDailyLimit } from '@/lib/rag/daily-limit';
import { OpenAIRagProviderError } from '@/lib/rag/openai-provider';
import { RagIndexMissingError, RagValidationError, runRagQuery, validateRagQueryRequest } from '@/lib/rag/query';
import { consumeRagRateLimit } from '@/lib/rag/rate-limit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isRagEnabled()) {
    logWarn('rag.query.disabled', { path: '/api/rag/query' });
    return NextResponse.json({ error: 'AI Q&A is temporarily disabled.' }, { status: 503 });
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    logWarn('rag.query.unauthenticated', { path: '/api/rag/query' });
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  let validatedRequest;

  try {
    validatedRequest = validateRagQueryRequest(body);
  } catch (error) {
    if (error instanceof RagValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    throw error;
  }

  const rateLimit = consumeRagRateLimit(user.id);
  if (!rateLimit.allowed) {
    logWarn('rag.query.rate_limited', {
      userId: user.id,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
      resetAt: new Date(rateLimit.resetAt).toISOString(),
    });

    return NextResponse.json(
      {
        error: `Rate limit exceeded. Try again in ${rateLimit.retryAfterSeconds} seconds.`,
        retry_after_seconds: rateLimit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  let dailyLimit;

  try {
    dailyLimit = await consumeRagDailyLimit(user.id);
  } catch (error) {
    logError('rag.query.daily_limit_failed', error, { userId: user.id });
    return NextResponse.json({ error: 'Unable to enforce AI usage limits.' }, { status: 500 });
  }

  if (!dailyLimit.allowed) {
    logWarn('rag.query.daily_limit_reached', {
      userId: user.id,
      used: dailyLimit.used,
      limit: dailyLimit.limit,
      resetAt: new Date(dailyLimit.resetAt).toISOString(),
    });

    return NextResponse.json(
      {
        error: 'Daily AI question limit reached. Try again tomorrow.',
        retry_after_seconds: dailyLimit.retryAfterSeconds,
        limit: dailyLimit.limit,
        remaining: dailyLimit.remaining,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(dailyLimit.retryAfterSeconds),
        },
      },
    );
  }

  try {
    const result = await runRagQuery(validatedRequest);
    logInfo('rag.query.succeeded', {
      userId: user.id,
      citations: result.citations.length,
      remainingMinuteRequests: rateLimit.remaining,
      remainingDailyRequests: dailyLimit.remaining,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RagValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof RagIndexMissingError) {
      logWarn('rag.query.index_missing', { userId: user.id });
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    if (error instanceof OpenAIRagProviderError) {
      logError('rag.query.provider_unavailable', error, {
        userId: user.id,
        phase: error.phase,
        statusCode: error.statusCode,
        providerCode: error.providerCode,
      });
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    logError('rag.query.failed', error, { userId: user.id });
    return NextResponse.json({ error: 'Unable to answer question.' }, { status: 500 });
  }
}
