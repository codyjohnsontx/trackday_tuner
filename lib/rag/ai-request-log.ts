// No `server-only` import here: this module is reachable only from route
// handlers, and the admin client it uses already pulls `lib/env.server`, which
// carries that guard. Importing it directly would also make the module
// unloadable in the unit suite, where `server-only` does not resolve.
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * The `ai_requests` audit trail and the rate limiting built on top of it.
 *
 * Both AI entry points write here and both count here. Counting is per rider
 * and not per route on purpose - the limit is a budget on what one rider can
 * spend at the model, so a day plan and a tuning question draw on the same
 * allowance and each is visible to the other's count.
 *
 * Every call takes a `logTag` so the console lines still say which route the
 * failure came from.
 */

export class RateLimitLookupError extends Error {
  constructor(cause: unknown) {
    super('Rate limit lookup failed.');
    this.name = 'RateLimitLookupError';
    this.cause = cause;
  }
}

export class ReservationError extends Error {
  constructor(cause: unknown) {
    super('Rate limit reservation failed.');
    this.name = 'ReservationError';
    this.cause = cause;
  }
}

export interface UpdateRequestLogParams {
  logTag: string;
  requestId: string;
  status: string;
  sessionId?: string | null;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs?: number | null;
  errorMessage?: string | null;
  refusalReason?: string | null;
  policyResult?: string | null;
  policyViolations?: string[];
  classifierStage?: string | null;
}

export async function reservePendingSlot(params: {
  logTag: string;
  userId: string;
  requestId: string;
  promptFingerprint: string;
  promptRedactedPreview: string;
}): Promise<void> {
  const admin = createAdminClient();
  // session_id is always null here, and takes no parameter for that reason: the
  // caller has not yet confirmed the referenced session exists, and
  // ai_requests.session_id has a FK to sessions(id) that would otherwise reject
  // a bogus reference with 503 instead of 404. The real session_id is stamped
  // on by updateRequestLog after the context lookup succeeds. A day plan has no
  // session at all and leaves it null for good.
  const { error } = await admin.from('ai_requests').insert({
    user_id: params.userId,
    session_id: null,
    request_id: params.requestId,
    status: 'pending',
    prompt_fingerprint: params.promptFingerprint,
    prompt_redacted_preview: params.promptRedactedPreview,
  });
  if (error) {
    console.error(`[${params.logTag}] reservation insert failed`, error);
    throw new ReservationError(error);
  }
}

export async function updateRequestLog(params: UpdateRequestLogParams): Promise<void> {
  const patch: Record<string, unknown> = {
    status: params.status,
    model: params.model ?? null,
    prompt_tokens: params.promptTokens ?? null,
    completion_tokens: params.completionTokens ?? null,
    latency_ms: params.latencyMs ?? null,
    error_message: params.errorMessage ?? null,
  };
  if (params.refusalReason !== undefined) {
    patch.refusal_reason = params.refusalReason;
  }
  if (params.policyResult !== undefined) {
    patch.policy_result = params.policyResult;
  }
  if (params.policyViolations !== undefined) {
    patch.policy_violations = params.policyViolations;
  }
  if (params.classifierStage !== undefined) {
    patch.classifier_stage = params.classifierStage;
  }
  if (params.sessionId !== undefined) {
    patch.session_id = params.sessionId;
  }
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from('ai_requests')
      .update(patch)
      .eq('request_id', params.requestId);
    if (error) {
      console.error(
        `[${params.logTag}] updateRequestLog failed`,
        { requestId: params.requestId, status: params.status },
        error,
      );
    }
  } catch (thrown) {
    // Guard against transport-layer exceptions (e.g., fetch timeouts) so
    // logging never shadows the user-facing response.
    console.error(`[${params.logTag}] updateRequestLog threw`, thrown);
  }
}

export async function releaseReservation(logTag: string, requestId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from('ai_requests')
      .delete()
      .eq('request_id', requestId);
    if (error) {
      console.error(`[${logTag}] releaseReservation failed`, { requestId }, error);
    }
  } catch (thrown) {
    // Best effort: the row will age out of the rate-limit window even if
    // this fails, but we still want to observe the failure.
    console.error(`[${logTag}] releaseReservation threw`, thrown);
  }
}

export async function countRequestsSince(
  logTag: string,
  userId: string,
  sinceMs: number,
): Promise<number> {
  const admin = createAdminClient();
  const sinceIso = new Date(Date.now() - sinceMs).toISOString();
  const { count, error } = await admin
    .from('ai_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', sinceIso);
  if (error) {
    console.error(`[${logTag}] rate limit count failed`, error);
    throw new RateLimitLookupError(error);
  }
  return count ?? 0;
}

async function countRequestsByStatusesSince(
  logTag: string,
  userId: string,
  statuses: string[],
  sinceMs: number,
): Promise<number> {
  const admin = createAdminClient();
  const sinceIso = new Date(Date.now() - sinceMs).toISOString();
  const { count, error } = await admin
    .from('ai_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', statuses)
    .gte('created_at', sinceIso);
  if (error) {
    console.error(`[${logTag}] refusal throttle count failed`, error);
    throw new RateLimitLookupError(error);
  }
  return count ?? 0;
}

const REFUSAL_THROTTLE_WINDOW_MS = 10 * 60 * 1000;
const MAX_RECENT_INJECTION_REFUSALS = 3;
const MAX_RECENT_SCOPE_REFUSALS = 8;

/**
 * The status a route writes when the refusal was caused by text the rider stored
 * on an earlier screen rather than by anything this request submitted.
 *
 * It is deliberately absent from both counted lists below. The rider submitted
 * nothing and is not probing, and because the offending text is stored the
 * refusal repeats on every attempt - counting it would spend the injection
 * budget three plans in and 429 them out of every AI route, over a note they
 * wrote weeks ago and were never told about. That is a self-inflicted denial of
 * service on a paid feature, so the throttle does not see this status at all.
 */
export const STORED_TEXT_INJECTION_REFUSAL_STATUS = 'completed_refusal_stored_text_injection';
export const STORED_TEXT_INJECTION_REFUSAL_REASON = 'stored_text_injection';

const THROTTLED_INJECTION_STATUSES = ['completed_refusal_prompt_injection'];
const THROTTLED_SCOPE_STATUSES = [
  'completed_refusal_out_of_domain',
  'completed_refusal_prompt_injection',
];

/**
 * A rider probing the guard rails burns refusals rather than completions, so
 * the ordinary per-hour limit barely moves. This counts the refusals
 * themselves and is a secondary safeguard: if it cannot be evaluated it fails
 * open, because an observability outage should not take the feature down.
 */
export async function isRefusalThrottled(logTag: string, userId: string): Promise<boolean> {
  try {
    const [recentPromptInjectionRefusals, recentScopeRefusals] = await Promise.all([
      countRequestsByStatusesSince(
        logTag,
        userId,
        THROTTLED_INJECTION_STATUSES,
        REFUSAL_THROTTLE_WINDOW_MS,
      ),
      countRequestsByStatusesSince(
        logTag,
        userId,
        THROTTLED_SCOPE_STATUSES,
        REFUSAL_THROTTLE_WINDOW_MS,
      ),
    ]);

    return (
      recentPromptInjectionRefusals >= MAX_RECENT_INJECTION_REFUSALS ||
      recentScopeRefusals >= MAX_RECENT_SCOPE_REFUSALS
    );
  } catch {
    return false;
  }
}

/**
 * Writes a terminal `ai_requests` row for a request refused before it ever
 * reserved a slot.
 *
 * The preflight screens that run before the reservation still have to be
 * audited: a refusal nobody records is a refusal the throttle cannot count, so
 * a caller probing the injection guard would never be slowed down. This inserts
 * the finished row directly rather than reserving and immediately updating, so
 * the refusal costs one write and no vehicle lookup.
 */
export async function recordRefusedRequest(params: {
  logTag: string;
  userId: string;
  requestId: string;
  status: string;
  refusalReason: string;
  classifierStage: string;
  promptFingerprint: string;
  promptRedactedPreview: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from('ai_requests').insert({
      user_id: params.userId,
      session_id: null,
      request_id: params.requestId,
      status: params.status,
      refusal_reason: params.refusalReason,
      policy_result: 'force_refusal',
      policy_violations: [],
      classifier_stage: params.classifierStage,
      prompt_fingerprint: params.promptFingerprint,
      prompt_redacted_preview: params.promptRedactedPreview,
    });
    if (error) {
      console.error(`[${params.logTag}] recordRefusedRequest failed`, { requestId: params.requestId }, error);
    }
  } catch (thrown) {
    // Never let the audit write shadow the refusal the rider is owed.
    console.error(`[${params.logTag}] recordRefusedRequest threw`, thrown);
  }
}
