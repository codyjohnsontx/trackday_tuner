import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getRealUser, getUserProfile, createClient, assertNotDemoRoute, reportError } = vi.hoisted(() => ({
  getRealUser: vi.fn(),
  getUserProfile: vi.fn(),
  createClient: vi.fn(),
  assertNotDemoRoute: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getRealUser }));
vi.mock('@/lib/actions/vehicles', () => ({ getUserProfile }));
vi.mock('@/lib/supabase/server', () => ({ createClient }));
vi.mock('@/lib/demo/mode', () => ({ assertNotDemoRoute }));
vi.mock('@/lib/monitoring/report-error', () => ({ reportError }));

import { PUT } from '@/app/api/sessions/[id]/outcome/route';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const REFERENCE_ID = '33333333-3333-4333-8333-333333333333';

/** The notes a rider typed. They must never come back in an error body. */
const NOTES = 'Rear felt planted onto the back straight.';

/**
 * The message PostgREST returns when it cannot resolve `save_session_outcome`,
 * recorded off a real stack. This is what a rider saw printed under their
 * unsaved notes.
 */
const PGRST202_MESSAGE =
  'Could not find the function public.save_session_outcome(p_notes, p_outcome, p_recommendation_helpfulness, p_recommendation_id, p_reference_session_id, p_rider_confidence, p_session_id, p_symptoms, p_user_id) in the schema cache';

/** The rest of that recorded body. A never-applied migration carries no hint. */
const PGRST202_DETAILS =
  'Searched for the function public.save_session_outcome with parameters p_notes, p_outcome, p_recommendation_helpfulness, p_recommendation_id, p_reference_session_id, p_rider_confidence, p_session_id, p_symptoms, p_user_id or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.';

/**
 * The SAME code and message when the route and the migration disagree by one
 * parameter instead - the one field that tells the two faults apart is the
 * `hint`, which names the signature PostgREST did find. A log that drops it
 * sends the operator back to a database to ask what it was already told.
 */
const PGRST202_DRIFT_HINT =
  'Perhaps you meant to call the function public.save_session_outcome(p_notes, p_outcome, p_recommendation_id, p_reference_session_id, p_rider_confidence, p_session_id, p_symptoms, p_user_id)';

function request() {
  return new Request(`http://localhost/api/sessions/${SESSION_ID}/outcome`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reference_session_id: REFERENCE_ID,
      recommendation_id: null,
      outcome: 'better',
      rider_confidence: 3,
      symptoms: [],
      notes: NOTES,
      recommendation_helpfulness: null,
    }),
  });
}

const context = { params: Promise.resolve({ id: SESSION_ID }) };

function rpcAnswers(answer: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(answer);
  createClient.mockResolvedValue({ rpc });
  return rpc;
}

describe('PUT /api/sessions/[id]/outcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertNotDemoRoute.mockResolvedValue(null);
    getRealUser.mockResolvedValue({ id: USER_ID });
    getUserProfile.mockResolvedValue({ tier: 'pro' });
  });

  it('saves the outcome when the database answers', async () => {
    const rpc = rpcAnswers({ data: { id: 'feedback-1', notes: NOTES }, error: null });

    const response = await PUT(request(), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith('save_session_outcome', expect.objectContaining({ p_notes: NOTES }));
  });

  // THE OUTAGE. `20260716000800` is not applied to the database this deployment
  // talks to (or PostgREST has not reloaded), so the save cannot succeed. What
  // the rider used to get was this raw message - nine Postgres parameter names -
  // printed under notes that were not saved.
  it('does not put a database error in front of the rider when the RPC is missing', async () => {
    rpcAnswers({ data: null, error: { code: 'PGRST202', message: PGRST202_MESSAGE } });

    const response = await PUT(request(), context);
    const body = await response.json() as { ok: boolean; error: string };

    // 503, because the deployment is broken rather than the request.
    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.error).not.toContain('save_session_outcome');
    expect(body.error).not.toContain('schema cache');
    // The message has to carry all three: that the save did not happen, that the
    // fault is not theirs, and the one action that saves their typing right now.
    // The rider's only copy is the text still in the box, and a reload takes it.
    expect(body.error).toMatch(/not saved/i);
    expect(body.error).toMatch(/on our end/i);
    expect(body.error).toMatch(/copy them somewhere safe/i);
  });

  it('reports the real PostgREST error to the server so the outage is visible', async () => {
    rpcAnswers({
      data: null,
      error: { code: 'PGRST202', message: PGRST202_MESSAGE, details: PGRST202_DETAILS, hint: null },
    });

    await PUT(request(), context);

    expect(reportError).toHaveBeenCalledWith(
      'session-outcome',
      expect.objectContaining({ message: PGRST202_MESSAGE }),
      expect.objectContaining({ reason: 'PGRST202', details: PGRST202_DETAILS, hint: null }),
    );
  });

  // The log has to carry the field that says WHICH fault this is. A missing
  // migration and a stale schema cache both answer `PGRST202` with a null hint;
  // a signature that drifted answers the same code with a hint naming what it
  // found, and that is a different fix. Dropping it makes the report unreadable.
  it('carries the hint that separates a drifted signature from a missing one', async () => {
    rpcAnswers({
      data: null,
      error: { code: 'PGRST202', message: PGRST202_MESSAGE, details: PGRST202_DETAILS, hint: PGRST202_DRIFT_HINT },
    });

    await PUT(request(), context);

    expect(reportError).toHaveBeenCalledWith(
      'session-outcome',
      expect.anything(),
      expect.objectContaining({ hint: PGRST202_DRIFT_HINT }),
    );
  });

  // A revoked `execute` is the same class: nothing the rider typed is wrong.
  it('treats a permission denial as an outage too', async () => {
    rpcAnswers({ data: null, error: { code: '42501', message: 'permission denied for function save_session_outcome' } });

    const response = await PUT(request(), context);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  // THE CLASS, not the two instances. A network blip or a paused project between
  // the function and PostgREST never reaches Postgres at all, and postgrest-js
  // RESOLVES that as an ordinary error carrying an empty `code` rather than
  // rejecting. Listing the deployment faults instead of the rider-facing one let
  // exactly this print `TypeError: fetch failed` under unsaved notes, with
  // nothing reaching Sentry or the log drain.
  const TRANSPORT_FAILURE = {
    code: '',
    message: 'TypeError: fetch failed',
    details: 'TypeError: fetch failed\n\nCaused by: Error: connect ECONNREFUSED (ECONNREFUSED)',
    hint: '',
  };

  it('does not show the rider a transport failure that never reached Postgres', async () => {
    rpcAnswers({ data: null, error: TRANSPORT_FAILURE });

    const response = await PUT(request(), context);
    const body = await response.json() as { ok: boolean; error: string };

    expect(response.status).toBe(503);
    expect(body.error).not.toContain('fetch failed');
    expect(body.error).not.toContain('ECONNREFUSED');
    expect(body.error).toMatch(/not saved/i);
    expect(reportError).toHaveBeenCalledWith(
      'session-outcome',
      expect.objectContaining({ message: 'TypeError: fetch failed' }),
      expect.objectContaining({ reason: '' }),
    );
  });

  // The same class one shape further out: postgrest-js gives an error no `code`
  // at all when it cannot parse the body, which is what a proxy's HTML error
  // page produces.
  it('does not show the rider an error that carries no code at all', async () => {
    rpcAnswers({ data: null, error: { message: '<html>502 Bad Gateway</html>' } });

    const response = await PUT(request(), context);
    const body = await response.json() as { ok: boolean; error: string };

    expect(response.status).toBe(503);
    expect(body.error).not.toContain('502 Bad Gateway');
    expect(reportError).toHaveBeenCalled();
  });

  // A schema drift the resolve-only health probe cannot see: the function is
  // there, but a table its body touches is not, so plpgsql raises at run time.
  it('does not show the rider a missing table from inside the function body', async () => {
    rpcAnswers({
      data: null,
      error: { code: '42P01', message: 'relation "public.race_engineer_memory" does not exist' },
    });

    const response = await PUT(request(), context);
    const body = await response.json() as { ok: boolean; error: string };

    expect(response.status).toBe(503);
    expect(body.error).not.toContain('race_engineer_memory');
    expect(reportError).toHaveBeenCalled();
  });

  // The function's own rejections still reach the rider unchanged: they are
  // about this request, and they are what tells them to pick another session.
  // This is the ONE code that does, so it is what keeps the inversion honest.
  it('passes a domain rejection through as a 400', async () => {
    rpcAnswers({ data: null, error: { code: 'P0001', message: 'session vehicle mismatch' } });

    const response = await PUT(request(), context);
    const body = await response.json() as { ok: boolean; error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe('session vehicle mismatch');
    expect(reportError).not.toHaveBeenCalled();
  });
});
