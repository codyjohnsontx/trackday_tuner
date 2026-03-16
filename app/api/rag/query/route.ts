import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { logError, logInfo, logWarn } from '@/lib/observability';
import { RagIndexMissingError, RagValidationError, runRagQuery } from '@/lib/rag/query';
import { consumeRagRateLimit } from '@/lib/rag/rate-limit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
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

  try {
    const result = await runRagQuery(body);
    logInfo('rag.query.succeeded', {
      userId: user.id,
      citations: result.citations.length,
      remainingRequests: rateLimit.remaining,
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

    logError('rag.query.failed', error, { userId: user.id });
    return NextResponse.json({ error: 'Unable to answer question.' }, { status: 500 });
  }
}
