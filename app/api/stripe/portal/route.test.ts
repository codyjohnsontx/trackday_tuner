import { beforeEach, describe, expect, it, vi } from 'vitest';

const createPortalSession = vi.fn();

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock('@/lib/actions/vehicles', () => ({
  getUserProfile: vi.fn(),
}));

vi.mock('@/lib/stripe/server', () => ({
  getStripeClient: vi.fn(() => ({
    billingPortal: { sessions: { create: createPortalSession } },
  })),
  getAppBaseUrl: vi.fn((requestUrl: string) => new URL(requestUrl).origin),
}));

import { getAuthenticatedUser } from '@/lib/auth';
import { getUserProfile } from '@/lib/actions/vehicles';
import { POST } from '@/app/api/stripe/portal/route';

describe('POST /api/stripe/portal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    const response = await POST(new Request('http://127.0.0.1:3000/api/stripe/portal', { method: 'POST' }));
    expect(response.status).toBe(401);
  });

  it('returns 400 when user has no stripe customer id', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'free', stripe_customer_id: null } as never);

    const response = await POST(new Request('http://127.0.0.1:3000/api/stripe/portal', { method: 'POST' }));
    expect(response.status).toBe(400);
  });

  it('creates billing portal session and returns url', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro', stripe_customer_id: 'cus_123' } as never);
    createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session/123' });

    const response = await POST(new Request('http://127.0.0.1:3000/api/stripe/portal', { method: 'POST' }));
    const body = await response.json();

    expect(createPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_123',
      }),
    );
    expect(body.url).toBe('https://billing.stripe.com/session/123');
  });
});
