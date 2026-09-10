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
 * Failures that mean this DEPLOYMENT is broken, not this request.
 *
 * `PGRST202` is the Save Outcome outage: PostgREST cannot resolve
 * `save_session_outcome`, because `20260716000800` was never applied to the
 * database or because the schema cache has not been reloaded - the two are
 * byte-identical from here. `42501` is the same class one step on: the function
 * exists and the caller has no `execute`.
 *
 * Both used to reach the rider as `error.message`, which is a list of nine
 * Postgres parameter names printed under their unsaved notes. Both codes were
 * measured against a real stack rather than taken from documentation; anything
 * else is a domain rejection raised by the function itself and still passes
 * through as a 400.
 *
 * `lib/monitoring/schema-contract.ts` is the check that finds this before a
 * rider does.
 */
const DEPLOYMENT_FAULT_CODES = new Set(['PGRST202', '42501']);

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
    if (DEPLOYMENT_FAULT_CODES.has(error.code ?? '')) {
      // The rider can do nothing about this and their notes are still in the
      // box, so the message says both. The real error - code, hint and all -
      // goes to the log rather than to the screen.
      reportError('session-outcome', new Error(error.message), {
        reason: error.code,
        query: 'save_session_outcome',
      });
      return NextResponse.json(
        {
          ok: false,
          error:
            'Saving outcomes is temporarily unavailable. Your notes have not been saved - copy them somewhere safe and try again shortly.',
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, outcome: data as Json as unknown as SessionFeedback });
}
