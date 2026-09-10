import { NextResponse } from 'next/server';
import { getRealUser } from '@/lib/auth';
import { getUserProfile } from '@/lib/actions/vehicles';
import { resolveUserAccess } from '@/lib/access';
import { assertNotDemoRoute } from '@/lib/demo/mode';
import { createClient } from '@/lib/supabase/server';
import { reportError } from '@/lib/monitoring/report-error';
import type { FeedbackOutcome, Json, SessionFeedback } from '@/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES = new Set<FeedbackOutcome>(['better', 'same', 'worse', 'unknown']);

/**
 * The ONE SQLSTATE whose message is written for the rider.
 *
 * `save_session_outcome` rejects a request with a bare `raise exception`, which
 * is `P0001`, and every one of those messages is about THIS request: "session
 * vehicle mismatch" tells a rider to go and pick another session. Those answer
 * `400` and say so verbatim. EVERYTHING ELSE IS A DEPLOYMENT OR TRANSPORT
 * FAULT, answers `503` with a message the rider can act on, and goes to
 * `reportError`.
 *
 * THE DIRECTION IS THE POINT, and it is the direction this started out
 * backwards. Listing the faults instead caught `PGRST202` - the Save Outcome
 * outage, where `20260716000800` is unapplied or PostgREST's schema cache is
 * stale, the two being byte-identical from here - and `42501`, where the
 * function is there and `execute` is revoked. Both were measured against a real
 * stack. But a list of the faults you thought of leaves every code you did not
 * printing raw Postgres under a rider's unsaved notes, and two reach this line
 * without any exotic state: `postgrest-js` resolves a transport failure as an
 * ordinary error carrying an EMPTY `code`, and a body it cannot parse as one
 * carrying NO `code` at all, so a network blip used to render as
 * `TypeError: fetch failed` on the screen with nothing logged.
 *
 * So assume a database error reaches the rider until you have read the code
 * that stops it. Same fail-closed allow-list doctrine, and for the same reason,
 * as `REPORTABLE_EXTRA_KEYS` in `lib/monitoring/report-error.ts`.
 *
 * `lib/monitoring/schema-contract.ts` is the check that finds the schema half
 * of this before a rider does.
 */
const RIDER_FACING_FAULT_CODE = 'P0001';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  const demoResponse = await assertNotDemoRoute();
  if (demoResponse) return demoResponse;

  const { id: sessionId } = await context.params;
  if (!UUID.test(sessionId)) return NextResponse.json({ ok: false, error: 'Invalid session id.' }, { status: 400 });

  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'Request body must be valid JSON.' }, { status: 400 }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return NextResponse.json({ ok: false, error: 'Request body must be an object.' }, { status: 400 });
  const body = input as Record<string, unknown>;
  const allowed = new Set(['reference_session_id', 'recommendation_id', 'outcome', 'rider_confidence', 'symptoms', 'notes', 'recommendation_helpfulness']);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) return NextResponse.json({ ok: false, error: `Unknown field: ${unknown}.` }, { status: 400 });

  if (typeof body.reference_session_id !== 'string' || !UUID.test(body.reference_session_id)) return NextResponse.json({ ok: false, error: 'reference_session_id must be a UUID.' }, { status: 400 });
  if (body.recommendation_id != null && (typeof body.recommendation_id !== 'string' || !UUID.test(body.recommendation_id))) return NextResponse.json({ ok: false, error: 'recommendation_id must be a UUID or null.' }, { status: 400 });
  if (typeof body.outcome !== 'string' || !OUTCOMES.has(body.outcome as FeedbackOutcome)) return NextResponse.json({ ok: false, error: 'Invalid outcome.' }, { status: 400 });
  if (body.rider_confidence != null && (!Number.isInteger(body.rider_confidence) || Number(body.rider_confidence) < 1 || Number(body.rider_confidence) > 5)) return NextResponse.json({ ok: false, error: 'rider_confidence must be 1–5.' }, { status: 400 });
  if (body.recommendation_helpfulness != null && (!Number.isInteger(body.recommendation_helpfulness) || Number(body.recommendation_helpfulness) < 1 || Number(body.recommendation_helpfulness) > 5)) return NextResponse.json({ ok: false, error: 'recommendation_helpfulness must be 1–5.' }, { status: 400 });
  if (body.recommendation_id == null && body.recommendation_helpfulness != null) return NextResponse.json({ ok: false, error: 'recommendation_helpfulness requires recommendation_id.' }, { status: 400 });
  if (!Array.isArray(body.symptoms) || body.symptoms.length > 8 || !body.symptoms.every((item) => typeof item === 'string' && item.length <= 64)) return NextResponse.json({ ok: false, error: 'symptoms must contain up to 8 short strings.' }, { status: 400 });
  if (body.notes != null && (typeof body.notes !== 'string' || body.notes.length > 1000)) return NextResponse.json({ ok: false, error: 'notes must be at most 1000 characters.' }, { status: 400 });

  const user = await getRealUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  if (!resolveUserAccess(await getUserProfile()).hasProAccess) return NextResponse.json({ ok: false, error: 'Session outcomes are a Pro feature.' }, { status: 402 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_session_outcome', {
    p_user_id: user.id,
    p_session_id: sessionId,
    p_reference_session_id: body.reference_session_id,
    p_recommendation_id: (body.recommendation_id as string | null | undefined) ?? null,
    p_outcome: body.outcome as FeedbackOutcome,
    p_rider_confidence: (body.rider_confidence as number | null | undefined) ?? null,
    p_symptoms: (body.symptoms as string[]).map((item) => item.trim()).filter(Boolean),
    p_notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
    p_recommendation_helpfulness: (body.recommendation_helpfulness as number | null | undefined) ?? null,
  });
  if (error) {
    if (error.code !== RIDER_FACING_FAULT_CODE) {
      // The rider can do nothing about this and their notes are still in the
      // box, so the message says both. The real error - code, hint and all -
      // goes to the log rather than to the screen.
      reportError('session-outcome', new Error(error.message), {
        reason: error.code,
        query: 'save_session_outcome',
        details: error.details,
        hint: error.hint,
      });
      return NextResponse.json(
        {
          ok: false,
          error:
            'Your outcome was not saved - something is wrong on our end, not with what you wrote. Your notes are still on this page: copy them somewhere safe before you leave, then try again in a few minutes.',
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, outcome: data as Json as unknown as SessionFeedback });
}
