export type LimitedResource = 'vehicles' | 'tracks' | 'sessions';

const FREE_PLAN_LIMITS: Record<LimitedResource, number> = {
  vehicles: 1,
  tracks: 3,
  sessions: 10,
};

const RESOURCE_LABELS: Record<LimitedResource, string> = {
  vehicles: 'vehicle',
  tracks: 'track',
  sessions: 'session',
};

export function getFreePlanLimit(resource: LimitedResource): number {
  return FREE_PLAN_LIMITS[resource];
}

export function getFreePlanLimitMessage(resource: LimitedResource): string {
  const limit = getFreePlanLimit(resource);
  const singular = RESOURCE_LABELS[resource];
  const plural = `${singular}s`;
  return `Free plan is limited to ${limit} ${limit === 1 ? singular : plural}. Upgrade to Pro for unlimited ${plural}.`;
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
