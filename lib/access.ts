import type { Profile, Tier, UserAccess } from '@/types';

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

  const betaAccessExpiresAt = profile?.beta_access_expires_at ?? null;
  const betaActive = Boolean(
    betaAccessExpiresAt && new Date(betaAccessExpiresAt).getTime() > now.getTime(),
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
