import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSession = vi.fn();
const createCustomer = vi.fn();
const deleteCustomer = vi.fn();
type ProfileUpdateResult = { data: { id: string } | null; error: { message: string } | null };

const profileMaybeSingle = vi.fn(
  async (): Promise<ProfileUpdateResult> => ({ data: { id: 'user-1' }, error: null }),
);
const profileSelect = vi.fn(() => ({ maybeSingle: profileMaybeSingle }));
const profileUpdateEq = vi.fn(() => ({ select: profileSelect }));
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
  getRealUser: vi.fn(),
}));

vi.mock('@/lib/actions/vehicles', () => ({
  getUserProfile: vi.fn(),
}));

// The customer link is written with the admin client, not the caller's session:
// `authenticated` holds no UPDATE on profiles, because RLS gates rows and not
// columns and a user-context update of their own row could also set tier.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from })),
}));

vi.mock('@/lib/stripe/server', () => ({
  getStripeClient: vi.fn(() => ({
    customers: { create: createCustomer, del: deleteCustomer },
    checkout: { sessions: { create: createSession } },
  })),
  getProMonthlyPriceId: vi.fn(() => 'price_pro_monthly'),
  getAppBaseUrl: vi.fn((requestUrl: string) => new URL(requestUrl).origin),
}));

import { getRealUser } from '@/lib/auth';
import { getUserProfile } from '@/lib/actions/vehicles';
import { POST } from '@/app/api/stripe/checkout/route';

describe('POST /api/stripe/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieValue.value = undefined;
    profileMaybeSingle.mockResolvedValue({ data: { id: 'user-1' }, error: null });
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getRealUser).mockResolvedValue(null);

    const response = await POST(new Request('http://127.0.0.1:3000/api/stripe/checkout', { method: 'POST' }));

    expect(response.status).toBe(401);
  });

  it('creates checkout session and returns url', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1', email: 'test@example.com' } as never);
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
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1', email: 'test@example.com' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'free', stripe_customer_id: null } as never);
    createCustomer.mockResolvedValue({ id: 'cus_123' });
    profileMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'invalid input syntax for type uuid' },
    });

    const response = await POST(new Request('http://127.0.0.1:3000/api/stripe/checkout', { method: 'POST' }));

    // A checkout session here would take payment the webhook could never match.
    expect(response.status).toBe(500);
    expect(createSession).not.toHaveBeenCalled();
    expect(deleteCustomer).toHaveBeenCalledWith('cus_123');
  });

  it('fails the request when the profile update matches no row', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1', email: 'test@example.com' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'free', stripe_customer_id: null } as never);
    createCustomer.mockResolvedValue({ id: 'cus_123' });
    // A missing row or an RLS denial updates nothing and reports no error.
    profileMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await POST(new Request('http://127.0.0.1:3000/api/stripe/checkout', { method: 'POST' }));

    expect(response.status).toBe(500);
    expect(createSession).not.toHaveBeenCalled();
    expect(deleteCustomer).toHaveBeenCalledWith('cus_123');
  });

  it('still fails the request when cleaning up the orphaned customer fails', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1', email: 'test@example.com' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'free', stripe_customer_id: null } as never);
    createCustomer.mockResolvedValue({ id: 'cus_123' });
    profileMaybeSingle.mockResolvedValue({ data: null, error: null });
    deleteCustomer.mockRejectedValue(new Error('stripe unavailable'));

    const response = await POST(new Request('http://127.0.0.1:3000/api/stripe/checkout', { method: 'POST' }));

    expect(response.status).toBe(500);
    expect(createSession).not.toHaveBeenCalled();
    expect(deleteCustomer).toHaveBeenCalledWith('cus_123');
  });
});
