import { describe, expect, it } from 'vitest';
import { GET } from '@/app/demo/exit/route';
import { DEMO_COOKIE_NAME } from '@/lib/demo/mode';

describe('GET /demo/exit', () => {
  it('clears demo mode and redirects to login', () => {
    const response = GET(new Request('http://127.0.0.1:3000/demo/exit'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3000/login');
    expect(response.headers.get('set-cookie')).toContain(`${DEMO_COOKIE_NAME}=`);
    expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  });

  /**
   * A rider following a password-reset link into the demo has to leave it before
   * the password form will render. Dropping them on `/login` strands them:
   * `/auth/callback` already signed them in, so `/login` forwards them to
   * `/dashboard`, which has no route back to `/reset-password`.
   */
  it('returns the rider to the page that sent them here', () => {
    const response = GET(new Request('http://127.0.0.1:3000/demo/exit?next=/reset-password'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3000/reset-password');
    expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  });

  it('still clears demo mode when it sends the rider onward', () => {
    const response = GET(new Request('http://127.0.0.1:3000/demo/exit?next=/reset-password'));

    expect(response.headers.get('set-cookie')).toContain(`${DEMO_COOKIE_NAME}=`);
    expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  });

  it('falls back to login rather than the app when next is not a safe local path', () => {
    for (const next of ['//evil.example', 'https://evil.example', '/\\evil.example', 'dashboard']) {
      const url = `http://127.0.0.1:3000/demo/exit?next=${encodeURIComponent(next)}`;
      const response = GET(new Request(url));

      expect(response.headers.get('location')).toBe('http://127.0.0.1:3000/login');
    }
  });
});
