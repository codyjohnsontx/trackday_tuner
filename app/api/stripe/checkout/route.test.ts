import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSession = vi.fn();
const createCustomer = vi.fn();
type ProfileUpdateResult = { error: { message: string } | null };

const profileUpdateEq = vi.fn(async (): Promise<ProfileUpdateResult> => ({ error: null }));
const profileUpdate = vi.fn(() => ({ eq: profileUpdateEq }));
const from = vi.fn(() => ({ update: profileUpdate }));

const cookieValue = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === 'trackday_tuner_demo' && cookieValue.value ? { value: cookieValue.value } : undefined,
  })),
}));

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
    cookieValue.value = undefined;
    profileUpdateEq.mockResolvedValue({ error: null });
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

  it('refuses demo mode without touching Stripe', async () => {
    cookieValue.value = '1';

    const response = await POST(new Request('http://127.0.0.1:3000/api/stripe/checkout', { method: 'POST' }));

    expect(response.status).toBe(403);
    expect(createCustomer).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('fails the request when the customer id cannot be saved to the profile', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1', email: 'test@example.com' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'free', stripe_customer_id: null } as never);
    createCustomer.mockResolvedValue({ id: 'cus_123' });
    profileUpdateEq.mockResolvedValue({ error: { message: 'invalid input syntax for type uuid' } });

    const response = await POST(new Request('http://127.0.0.1:3000/api/stripe/checkout', { method: 'POST' }));

    // A checkout session here would take payment the webhook could never match.
    expect(response.status).toBe(500);
    expect(createSession).not.toHaveBeenCalled();
  });
});
