import { describe, expect, it } from 'vitest';
import { effectiveTier, resolveUserAccess } from '@/lib/access';
import type { Profile } from '@/types';

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    tier: 'free',
    beta_cohort: null,
    beta_access_started_at: null,
    beta_access_expires_at: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_price_id: null,
    stripe_current_period_end: null,
    ...overrides,
  };
}

describe('resolveUserAccess', () => {
  const now = new Date('2026-07-16T12:00:00.000Z');

  it('grants all features to an active beta profile', () => {
    expect(resolveUserAccess(profile({ beta_access_expires_at: '2026-08-01T00:00:00.000Z' }), now)).toMatchObject({
      hasProAccess: true,
      source: 'beta',
    });
  });

  it('expires beta access exactly at the deadline', () => {
    expect(resolveUserAccess(profile({ beta_access_expires_at: now.toISOString() }), now).hasProAccess).toBe(false);
  });

  it('keeps Stripe Pro active after beta expiration', () => {
    expect(resolveUserAccess(profile({ tier: 'pro', beta_access_expires_at: '2026-01-01T00:00:00.000Z' }), now)).toMatchObject({
      hasProAccess: true,
      source: 'stripe',
    });
  });

  it('maps effective access back to the existing component tier contract', () => {
    expect(effectiveTier(profile({ beta_access_expires_at: '2026-08-01T00:00:00.000Z' }), now)).toBe('pro');
  });
});
