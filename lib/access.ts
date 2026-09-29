import type { Profile, Tier, UserAccess } from '@/types';

// create_session_with_laps (20260928002300) reads this same rule in SQL to lift
// the free-plan session cap. tests/e2e/create-session-with-laps.spec.ts checks
// the SQL against this function on a real database;
// tests/unit/session-create-plan-cap.test.ts guards the two copies drifting apart.
export function resolveUserAccess(
  profile: Profile | null | undefined,
  now: Date = new Date(),
): UserAccess {
  const billingTier = profile?.tier ?? 'free';
  if (billingTier === 'pro') {
    return {
      billingTier,
      hasProAccess: true,
      source: 'stripe',
      betaAccessExpiresAt: profile?.beta_access_expires_at ?? null,
    };
  }

  const betaAccessStartedAt = profile?.beta_access_started_at ?? null;
  const betaAccessExpiresAt = profile?.beta_access_expires_at ?? null;
  const betaActive = Boolean(
    betaAccessExpiresAt &&
      new Date(betaAccessExpiresAt).getTime() > now.getTime() &&
      (!betaAccessStartedAt || new Date(betaAccessStartedAt).getTime() <= now.getTime()),
  );

  return {
    billingTier,
    hasProAccess: betaActive,
    source: betaActive ? 'beta' : 'free',
    betaAccessExpiresAt,
  };
}

export function effectiveTier(profile: Profile | null | undefined, now?: Date): Tier {
  return resolveUserAccess(profile, now).hasProAccess ? 'pro' : 'free';
}
