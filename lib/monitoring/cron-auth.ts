import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getMonitoringCronSecret } from '@/lib/env.server';

/**
 * The gate in front of every route `.github/workflows/monitoring.yml` calls on a
 * schedule. The workflow presents `Authorization: Bearer $MONITORING_CRON_SECRET`
 * - the same header a Vercel Cron job sends, so moving the schedule onto Vercel
 * later needs no change here.
 *
 * Returns the response to answer with when the caller is not the scheduler, or
 * `null` when it is.
 */
export function refuseUnlessScheduler(request: NextRequest): NextResponse | null {
  const presented = presentedSecret(request);
  if (!presented) return unauthorized();

  let expected: string;
  try {
    expected = getMonitoringCronSecret();
  } catch {
    // Fail closed. Without the secret there is no way to tell the scheduler
    // from anyone else.
    //
    // Nothing is reported here, and that is not an oversight. An unset
    // `MONITORING_CRON_SECRET` is a documented configuration state rather than
    // a fault - `docs/monitoring.md` lists this exact 503 as the answer until
    // the operator finishes step 2 - and the scheduled workflow already fails
    // every 15 minutes on the non-200. Reporting is reachable before any
    // credential is verified, since any `Bearer x` gets this far, so a report
    // here is one Sentry event and one log line per unauthenticated request.
    return NextResponse.json({ error: 'Monitoring is not configured.' }, { status: 503 });
  }

  return secretMatches(presented, expected) ? null : unauthorized();
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
}

function presentedSecret(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, and the length of a secret is
  // not worth leaking through a thrown 500 either.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
