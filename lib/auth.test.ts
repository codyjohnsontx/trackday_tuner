import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieValue = vi.hoisted(() => ({ demo: undefined as string | undefined }));
const supabaseUser = vi.hoisted(() => ({ value: null as { id: string } | null }));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === 'trackday_tuner_demo' && cookieValue.demo ? { value: cookieValue.demo } : undefined,
    getAll: () =>
      supabaseUser.value ? [{ name: 'sb-project-auth-token', value: 'token' }] : [],
  })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: supabaseUser.value } }) },
  })),
}));

import { DEMO_USER_EMAIL, getRealUser, getViewer, isAuthenticated } from '@/lib/auth';
import { DEMO_USER_ID } from '@/lib/demo/mode';

describe('getRealUser', () => {
  beforeEach(() => {
    cookieValue.demo = undefined;
    supabaseUser.value = null;
  });

  it('returns null for a demo request', async () => {
    cookieValue.demo = '1';

    // The whole point of R2: a demo cookie can never produce a user object.
    await expect(getRealUser()).resolves.toBeNull();
  });

  it('returns null when no session cookie is present', async () => {
    await expect(getRealUser()).resolves.toBeNull();
  });

  it('returns null for a signed-in rider who entered the demo', async () => {
    // Entering the demo does not sign a rider out, so both cookies are present.
    // Without demo taking precedence, the app shows demo data while an ungated
    // read hands back the real account.
    cookieValue.demo = '1';
    supabaseUser.value = { id: 'user-1' };

    await expect(getRealUser()).resolves.toBeNull();
  });

  it('returns the signed-in user', async () => {
    supabaseUser.value = { id: 'user-1' };

    await expect(getRealUser()).resolves.toEqual({ id: 'user-1' });
  });
});

describe('getViewer', () => {
  beforeEach(() => {
    cookieValue.demo = undefined;
    supabaseUser.value = null;
  });

  it('reports demo as its own status rather than as a user', async () => {
    cookieValue.demo = '1';

    await expect(getViewer()).resolves.toEqual({
      status: 'demo',
      user: { id: DEMO_USER_ID, email: DEMO_USER_EMAIL },
    });
  });

  it('reports an anonymous visitor', async () => {
    await expect(getViewer()).resolves.toEqual({ status: 'anonymous' });
  });

  it('reports a signed-in rider', async () => {
    supabaseUser.value = { id: 'user-1' };

    await expect(getViewer()).resolves.toEqual({
      status: 'authenticated',
      user: { id: 'user-1' },
    });
  });
});

describe('isAuthenticated', () => {
  beforeEach(() => {
    cookieValue.demo = undefined;
    supabaseUser.value = null;
  });

  it('is false in demo mode, which is not a signed-in state', async () => {
    cookieValue.demo = '1';

    await expect(isAuthenticated()).resolves.toBe(false);
  });

  it('is false for a signed-in rider who entered the demo', async () => {
    cookieValue.demo = '1';
    supabaseUser.value = { id: 'user-1' };

    await expect(isAuthenticated()).resolves.toBe(false);
  });

  it('is true for a signed-in rider', async () => {
    supabaseUser.value = { id: 'user-1' };

    await expect(isAuthenticated()).resolves.toBe(true);
  });
});
