import { afterEach, describe, expect, it } from 'vitest';
import { getFounderPromoCode } from '@/lib/billing';

describe('getFounderPromoCode', () => {
  const originalValue = process.env.NEXT_PUBLIC_STRIPE_FOUNDER_PROMO_CODE;

  afterEach(() => {
    process.env.NEXT_PUBLIC_STRIPE_FOUNDER_PROMO_CODE = originalValue;
  });

  it('uses env value when provided', () => {
    process.env.NEXT_PUBLIC_STRIPE_FOUNDER_PROMO_CODE = 'EARLY100';
    expect(getFounderPromoCode()).toBe('EARLY100');
  });

  it('falls back to FOUNDER100', () => {
    delete process.env.NEXT_PUBLIC_STRIPE_FOUNDER_PROMO_CODE;
    expect(getFounderPromoCode()).toBe('FOUNDER100');
  });
});
