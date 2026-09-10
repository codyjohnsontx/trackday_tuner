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
    // It has to say the notes are not saved: the rider's only copy is the text
    // still sitting in the box, and a reload takes it.
    expect(body.error).toMatch(/not been saved/i);
  });

  it('reports the real PostgREST error to the server so the outage is visible', async () => {
    rpcAnswers({ data: null, error: { code: 'PGRST202', message: PGRST202_MESSAGE } });

    await PUT(request(), context);

    expect(reportError).toHaveBeenCalledWith(
      'session-outcome',
      expect.objectContaining({ message: PGRST202_MESSAGE }),
      expect.objectContaining({ reason: 'PGRST202' }),
    );
  });

  // A revoked `execute` is the same class: nothing the rider typed is wrong.
  it('treats a permission denial as an outage too', async () => {
    rpcAnswers({ data: null, error: { code: '42501', message: 'permission denied for function save_session_outcome' } });

    const response = await PUT(request(), context);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  // The function's own rejections still reach the rider unchanged: they are
  // about this request, and they are what tells them to pick another session.
  it('passes a domain rejection through as a 400', async () => {
    rpcAnswers({ data: null, error: { code: 'P0001', message: 'session vehicle mismatch' } });

    const response = await PUT(request(), context);
    const body = await response.json() as { ok: boolean; error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe('session vehicle mismatch');
    expect(reportError).not.toHaveBeenCalled();
  });
});
