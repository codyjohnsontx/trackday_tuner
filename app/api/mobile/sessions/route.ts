import { NextResponse } from 'next/server';
import { resolveUserAccess } from '@/lib/access';
import { readBoundedJson } from '@/lib/http/bounded-json';
import { mobileCorsHeaders, mobilePreflightResponse } from '@/lib/mobile/cors';
import { reportError } from '@/lib/monitoring/report-error';
import { parseCreateSessionRequest } from '@/lib/sessions/parse-create-request';
import { createSessionForUser, type CreateSessionFailureKind } from '@/lib/sessions/create';
import { authenticateBearer } from '@/lib/supabase/bearer';
import type { Profile } from '@/types';

/**
 * Where a session logged on the phone reaches the server (owner decision D1).
 *
 * It is the website's own create - `createSessionForUser`, the function the
 * session form's server action calls - behind a bearer token instead of cookies,
 * so the free-plan cap, track resolution, layout check, change records and
 * rollbacks have one copy whichever surface a session came from.
 *
 * The body carries an `id` the phone minted, and the create is idempotent on it:
 * a replay after a lost response answers 200 with the stored row and
 * `replayed: true` rather than logging the outing twice. When the rider has
 * deleted that session since, the replay answers 200 with `replayed: true`,
 * `deleted: true` and `session: null`: the save was handled and the rider has
 * since deleted that session, so the phone clears the outbox entry and removes
 * its local copy of the session, and the session is not written again.
 *
 * THE STATUS IS THE PHONE'S RETRY DECISION, so it is chosen by who can fix the
 * failure rather than by what failed:
 * - 400, 402, 409 - the rider has to change something (a missing answer, the
 *   free-plan cap, an id already in use). The sync engine parks the entry with
 *   `error`, which is written for a rider, and never retries it on its own.
 * - 401 - no usable session. The phone treats it as signed out.
 * - 503 - ours, and transient. The entry is retried with back-off, which is why
 *   an unreachable GoTrue is 503 and not 401: that would sign every rider out.
 */

const MAX_BODY_BYTES = 64 * 1024;
const METHODS = ['POST'] as const;

const STATUS_BY_KIND: Record<CreateSessionFailureKind, number> = {
  invalid: 400,
  plan_limit: 402,
  id_taken: 409,
  fault: 503,
};

const UNAVAILABLE_MESSAGE =
  'Track Tuner could not be reached just now. Your session is still on this phone and will be sent again.';

class ProfileReadError extends Error {}

export function OPTIONS(request: Request) {
  return mobilePreflightResponse(request, METHODS);
}

export async function POST(request: Request) {
  const headers = mobileCorsHeaders(request);
  const reply = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers });

  const auth = await authenticateBearer(request);
  if (auth.status === 'unavailable') {
    reportError('mobile-sessions', auth.error, { check: 'bearer-auth' });
    return reply({ ok: false, error: UNAVAILABLE_MESSAGE }, 503);
  }
  if (auth.status === 'unauthenticated') {
    return reply({ ok: false, error: 'Not authenticated.' }, 401);
  }

  // Streamed and cut off at the limit, so an oversized body is refused without
  // first being buffered whole.
  const read = await readBoundedJson(request, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? reply({ ok: false, error: 'Request body is too large.' }, 413)
      : reply({ ok: false, error: 'Request body must be valid JSON.' }, 400);
  }

  const parsed = parseCreateSessionRequest(read.value);
  if (!parsed.ok) return reply({ ok: false, error: parsed.error }, 400);

  const { supabase, user } = auth;
  try {
    const result = await createSessionForUser(
      {
        supabase,
        userId: user.id,
        // The website reads this through `getUserProfile`, which answers a
        // failed read as "no profile" and so as the free plan. Here that would
        // hold a Pro rider to the free custom-track cap on a failed read, so a
        // failed read is a 503 and retried. The session cap is read inside
        // `create_session_with_laps`, which reads the profile itself.
        resolveProAccess: async () => {
          const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
          if (error) throw new ProfileReadError(error.message);
          return resolveUserAccess(data as Profile | null).hasProAccess;
        },
        report: reportError,
      },
      parsed.data.input,
      { id: parsed.data.id },
    );

    if (!result.ok) {
      const error = result.kind === 'fault' ? UNAVAILABLE_MESSAGE : result.error;
      return reply({ ok: false, error }, STATUS_BY_KIND[result.kind]);
    }
    if (result.data.deleted) return reply({ ok: true, session: null, replayed: true, deleted: true }, 200);
    return reply({ ok: true, session: result.data.session, replayed: result.data.replayed }, 200);
  } catch (error) {
    reportError('mobile-sessions', error, {
      check: error instanceof ProfileReadError ? 'profile-read' : 'create',
      table: error instanceof ProfileReadError ? 'profiles' : 'sessions',
    });
    return reply({ ok: false, error: UNAVAILABLE_MESSAGE }, 503);
  }
}
