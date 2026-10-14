export type LimitedResource = 'vehicles' | 'tracks' | 'sessions' | 'attachments';

// `sessions` is enforced in SQL: create_session_with_laps counts every create,
// the website form's and the phone's, under a per-rider lock (20260928002300),
// and this number is what the app says the cap is. tests/db/ runs the SQL at this
// cap on a real database on every pull request, so the two cannot drift apart
// unnoticed.
//
// `attachments` is per bike and is enforced the same way, by
// reserve_service_attachment under a per-book lock (20261014000400), and
// tests/db/service-attachments.spec.ts holds the SQL to this number.
const FREE_PLAN_LIMITS: Record<LimitedResource, number> = {
  vehicles: 1,
  tracks: 3,
  sessions: 10,
  attachments: 25,
};

const RESOURCE_LABELS: Record<LimitedResource, string> = {
  vehicles: 'vehicle',
  tracks: 'track',
  sessions: 'session',
  attachments: 'attachment',
};

/** What a limit is counted over, when it is not the rider's whole account. */
const RESOURCE_SCOPES: Partial<Record<LimitedResource, string>> = {
  attachments: ' per bike',
};

/**
 * The largest one service book attachment may be, in bytes: 10 MB on the free
 * plan (owner, PQ3) and the bucket's 25 MB on Pro. Enforced by
 * reserve_service_attachment and again by confirm_service_attachment against
 * what storage actually holds; the browser checks first so a rider is told
 * before uploading.
 */
export const FREE_PLAN_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const PRO_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export function attachmentMaxBytes(hasProAccess: boolean): number {
  return hasProAccess ? PRO_ATTACHMENT_MAX_BYTES : FREE_PLAN_ATTACHMENT_MAX_BYTES;
}

export function getFreePlanLimit(resource: LimitedResource): number {
  return FREE_PLAN_LIMITS[resource];
}

export function getFreePlanLimitMessage(resource: LimitedResource): string {
  const limit = getFreePlanLimit(resource);
  const singular = RESOURCE_LABELS[resource];
  const plural = `${singular}s`;
  const scope = RESOURCE_SCOPES[resource] ?? '';
  return `Free plan is limited to ${limit} ${limit === 1 ? singular : plural}${scope}. Upgrade to Pro for unlimited ${plural}.`;
}

/**
 * Heading for the screen a rider lands on once the limit is already reached.
 * Derived from the same table as the message so the two can never name a
 * different resource.
 */
export function getFreePlanLimitTitle(resource: LimitedResource): string {
  const singular = RESOURCE_LABELS[resource];
  return `${singular.charAt(0).toUpperCase()}${singular.slice(1)} limit reached`;
}

/**
 * True when this rider cannot add another `resource` on their current plan.
 *
 * The create routes and the list screens both ask this, and they used to answer
 * it with their own inline `>= 10` / `>= 1` / `>= 3`. A limit spelled out at
 * five call sites is a limit that can disagree with the server action enforcing
 * it, which is how a rider came to be offered a form that could never save.
 */
export function isAtFreePlanLimit(
  resource: LimitedResource,
  count: number,
  hasProAccess: boolean,
): boolean {
  return !hasProAccess && count >= getFreePlanLimit(resource);
}
