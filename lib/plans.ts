type LimitedResource = 'vehicles' | 'tracks' | 'sessions';

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
