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
});
