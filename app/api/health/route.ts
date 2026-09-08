import { NextResponse } from 'next/server';
import { healthHttpStatus, runHealthChecks } from '@/lib/monitoring/health';

/**
 * The uptime endpoint. `200` when the deployment can actually serve, `503` with
 * a named failing check when it cannot - see `lib/monitoring/health.ts` for
 * what is checked and why.
 *
 * `nodejs` because the RAG index check reads the file from disk, and the index
 * has to be traced into *this* route's bundle as well as the AI routes' - see
 * `outputFileTracingIncludes` in `next.config.ts`, which
 * `tests/unit/rag-index-bundling.test.ts` keeps honest. A health check that
 * loads the index from a bundle no rider ever hits would be a decoration.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const report = await runHealthChecks();
  return NextResponse.json(report, {
    status: healthHttpStatus(report),
    headers: {
      // An uptime monitor must see this deployment answer now, never a CDN's
      // memory of the last time it did.
      'cache-control': 'no-store, max-age=0',
    },
  });
}
