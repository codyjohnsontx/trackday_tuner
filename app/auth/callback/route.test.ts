import { beforeEach, describe, expect, it, vi } from 'vitest';

const exchangeCodeForSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession,
    },
  })),
}));

import { GET } from '@/app/auth/callback/route';
import { sanitizeNextPath } from '@/lib/auth/redirects';

describe('sanitizeNextPath', () => {
  it('defaults to dashboard for invalid values', () => {
    expect(sanitizeNextPath(null)).toBe('/dashboard');
    expect(sanitizeNextPath('dashboard')).toBe('/dashboard');
    expect(sanitizeNextPath('//evil.example')).toBe('/dashboard');
  });

  it('allows internal paths', () => {
    expect(sanitizeNextPath('/dashboard')).toBe('/dashboard');
    expect(sanitizeNextPath('/tools')).toBe('/tools');
  });
});

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to login error when code is missing', async () => {
    const response = await GET(new Request('http://127.0.0.1:3000/auth/callback?next=/dashboard'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3000/login?error=oauth_callback_failed');
  });

  it('exchanges code and redirects to dashboard by default', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(new Request('http://127.0.0.1:3000/auth/callback?code=abc123'));

    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc123');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3000/dashboard');
  });

  it('redirects to valid internal next path when provided', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(new Request('http://127.0.0.1:3000/auth/callback?code=abc123&next=/tools'));

    expect(response.headers.get('location')).toBe('http://127.0.0.1:3000/tools');
  });

  it('falls back to dashboard when next is unsafe', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(
      new Request('http://127.0.0.1:3000/auth/callback?code=abc123&next=https://evil.example')
    );

    expect(response.headers.get('location')).toBe('http://127.0.0.1:3000/dashboard');
  });

  it('redirects to login error when exchange fails', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'bad code' } });

    const response = await GET(new Request('http://127.0.0.1:3000/auth/callback?code=bad'));

    expect(response.headers.get('location')).toBe('http://127.0.0.1:3000/login?error=oauth_callback_failed');
  });
});
