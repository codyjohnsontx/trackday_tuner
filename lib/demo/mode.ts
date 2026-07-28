import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { ActionResult } from '@/types';

export const DEMO_COOKIE_NAME = 'trackday_tuner_demo';
export const DEMO_USER_ID = 'demo-user';
export const DEMO_READ_ONLY_ERROR = 'Demo mode is read-only. Start a real account to save changes.';

export async function isDemoMode(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get(DEMO_COOKIE_NAME)?.value === '1';
  } catch {
    return false;
  }
}

export async function assertNotDemoMode<T = never>(): Promise<ActionResult<T> | null> {
  if (await isDemoMode()) {
    return { ok: false, error: DEMO_READ_ONLY_ERROR };
  }

  return null;
}

/**
 * Route-handler counterpart to `assertNotDemoMode`.
 *
 * `getAuthenticatedUser()` returns a synthetic demo user, so a route that only
 * checks for a user treats the public demo cookie as a real session. Every
 * write route must call this before acting on that user.
 */
export async function assertNotDemoRoute(): Promise<NextResponse | null> {
  if (await isDemoMode()) {
    return NextResponse.json({ ok: false, error: DEMO_READ_ONLY_ERROR }, { status: 403 });
  }

  return null;
}
