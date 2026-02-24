import { describe, expect, it } from 'vitest';
import { getTierFromSubscription, unixToIso } from '@/lib/stripe/entitlements';

describe('getTierFromSubscription', () => {
  const baseSubscription = {
    status: 'active',
    items: {
      data: [{ price: { id: 'price_pro_monthly' } }],
    },
  };

  it('returns pro for active subscription with pro price', () => {
    expect(
      getTierFromSubscription(baseSubscription as never, 'price_pro_monthly'),
    ).toBe('pro');
  });

  it('returns free for non-pro price', () => {
    expect(
      getTierFromSubscription(baseSubscription as never, 'other_price'),
    ).toBe('free');
  });

  it('returns free for canceled subscription', () => {
    expect(
      getTierFromSubscription(
        { ...baseSubscription, status: 'canceled' } as never,
        'price_pro_monthly',
      ),
    ).toBe('free');
  });
});

describe('unixToIso', () => {
  it('returns null for empty values', () => {
    expect(unixToIso(null)).toBeNull();
    expect(unixToIso(undefined)).toBeNull();
  });

  it('returns iso string for unix timestamp', () => {
    expect(unixToIso(1700000000)).toBe('2023-11-14T22:13:20.000Z');
  });
});
