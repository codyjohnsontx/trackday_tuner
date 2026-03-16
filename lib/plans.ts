export const FREE_PLAN_LIMITS = {
  vehicles: 1,
  tracks: 3,
  sessions: 10,
} as const;

const RESOURCE_LABELS = {
  vehicles: 'vehicles',
  tracks: 'tracks',
  sessions: 'sessions',
} as const;

const RESOURCE_SINGULAR_LABELS = {
  vehicles: 'vehicle',
  tracks: 'track',
  sessions: 'session',
} as const;

type FreePlanResource = keyof typeof FREE_PLAN_LIMITS;

export function getFreePlanLimit(resource: FreePlanResource): number {
  return FREE_PLAN_LIMITS[resource];
}

export function getFreePlanLimitMessage(resource: FreePlanResource): string {
  const quantityLabel =
    getFreePlanLimit(resource) === 1
      ? RESOURCE_SINGULAR_LABELS[resource]
      : RESOURCE_LABELS[resource];

  return `Free plan is limited to ${getFreePlanLimit(resource)} ${quantityLabel}. Upgrade to Pro for unlimited ${RESOURCE_LABELS[resource]}.`;
}

export function formatFreePlanUsage(resource: FreePlanResource, count: number): string {
  const label = RESOURCE_LABELS[resource];
  const singular = label.endsWith('s') && count === 1 ? label.slice(0, -1) : label;
  return `Free plan · ${count}/${getFreePlanLimit(resource)} ${count === 1 ? singular : label}`;
}
