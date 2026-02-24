import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSession = vi.fn();
const createCustomer = vi.fn();
const profileUpdateEq = vi.fn(async () => ({ error: null }));
const profileUpdate = vi.fn(() => ({ eq: profileUpdateEq }));
const from = vi.fn(() => ({ update: profileUpdate }));

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock('@/lib/actions/vehicles', () => ({
  getUserProfile: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from })),
}));

vi.mock('@/lib/stripe/server', () => ({
  getStripeClient: vi.fn(() => ({
    customers: { create: createCustomer },
    checkout: { sessions: { create: createSession } },
  })),
  getProMonthlyPriceId: vi.fn(() => 'price_pro_monthly'),
  getAppBaseUrl: vi.fn((requestUrl: string) => new URL(requestUrl).origin),
}));

import { getAuthenticatedUser } from '@/lib/auth';
import { getUserProfile } from '@/lib/actions/vehicles';
import { POST } from '@/app/api/stripe/checkout/route';

describe('POST /api/stripe/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    const response = await POST(new Request('http://127.0.0.1:3000/api/stripe/checkout', { method: 'POST' }));

    expect(response.status).toBe(401);
  });

  it('creates checkout session and returns url', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1', email: 'test@example.com' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'free', stripe_customer_id: null } as never);
    createCustomer.mockResolvedValue({ id: 'cus_123' });
    createSession.mockResolvedValue({ url: 'https://checkout.stripe.com/session/123' });

    const response = await POST(new Request('http://127.0.0.1:3000/api/stripe/checkout', { method: 'POST' }));
    const body = await response.json();

    expect(createCustomer).toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_123',
        line_items: [{ price: 'price_pro_monthly', quantity: 1 }],
        allow_promotion_codes: true,
      }),
    );
    expect(body.url).toBe('https://checkout.stripe.com/session/123');
  });
});
