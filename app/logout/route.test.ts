import { beforeEach, describe, expect, it, vi } from 'vitest';

const signOut = vi.fn(async () => ({ error: null }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { signOut } })),
}));

const { GET } = await import('@/app/logout/route');

describe('GET /logout', () => {
  beforeEach(() => signOut.mockClear());

  it('signs out and redirects to login', async () => {
    const response = await GET(new Request('http://127.0.0.1:3000/logout'));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3000/login');
  });

  /**
   * A buyer who opened a handover link under the wrong account signs out to
   * sign back in with the right one, and has to land on the link again.
   */
  it('hands a safe next path on to login', async () => {
    const handover = '/transfer/abc_DEF-123';
    const response = await GET(new Request(`http://127.0.0.1:3000/logout?next=${encodeURIComponent(handover)}`));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(response.headers.get('location')).toBe(`http://127.0.0.1:3000/login?next=${encodeURIComponent(handover)}`);
  });

  it('drops a next that is not a safe local path', async () => {
    for (const next of ['//evil.example', 'https://evil.example', '/\\evil.example', 'dashboard']) {
      const response = await GET(new Request(`http://127.0.0.1:3000/logout?next=${encodeURIComponent(next)}`));

      expect(response.headers.get('location')).toBe('http://127.0.0.1:3000/login');
    }
  });
});
