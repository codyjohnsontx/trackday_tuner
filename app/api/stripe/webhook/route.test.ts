import { beforeEach, describe, expect, it, vi } from 'vitest';

const constructEvent = vi.fn();
const subscriptionRetrieve = vi.fn();
const eq = vi.fn(async () => ({ error: null }));
const update = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ update }));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => (name === 'stripe-signature' ? 'sig_123' : null),
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from })),
}));

vi.mock('@/lib/stripe/server', () => ({
  getStripeClient: vi.fn(() => ({
    webhooks: { constructEvent },
    subscriptions: { retrieve: subscriptionRetrieve },
  })),
  getProMonthlyPriceId: vi.fn(() => 'price_pro_monthly'),
}));

import { POST } from '@/app/api/stripe/webhook/route';

describe('POST /api/stripe/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  });

  it('returns 400 for invalid signature', async () => {
    constructEvent.mockImplementation(() => {
      throw new Error('bad sig');
    });

    const response = await POST(
      new Request('http://127.0.0.1:3000/api/stripe/webhook', {
        method: 'POST',
        body: '{}',
      }),
    );

    expect(response.status).toBe(400);
  });

  it('handles subscription.updated and syncs profile tier', async () => {
    constructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          status: 'active',
          customer: 'cus_123',
          current_period_end: 1700000000,
          items: { data: [{ price: { id: 'price_pro_monthly' } }] },
        },
      },
    });

    const response = await POST(
      new Request('http://127.0.0.1:3000/api/stripe/webhook', {
        method: 'POST',
        body: '{}',
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.received).toBe(true);
    expect(from).toHaveBeenCalledWith('profiles');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: 'pro',
        stripe_customer_id: 'cus_123',
        stripe_subscription_id: 'sub_123',
      }),
    );
  });
});
