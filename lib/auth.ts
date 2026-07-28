import { cache } from 'react';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { DEMO_USER_ID, isDemoMode } from '@/lib/demo/mode';
import { createClient } from '@/lib/supabase/server';

export const DEMO_USER_EMAIL = 'demo@trackdaytuner.local';

export type DemoUser = {
  id: typeof DEMO_USER_ID;
  email: typeof DEMO_USER_EMAIL;
};

/**
 * Who is looking at the page. Demo is a distinct state rather than a user object
 * that happens to be fake, so a caller cannot read a demo identity without having
 * written the branch that handles it.
 */
export type Viewer =
  | { status: 'anonymous' }
  | { status: 'demo'; user: DemoUser }
  | { status: 'authenticated'; user: User };

function hasSupabaseAuthCookie(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return cookieStore.getAll().some(({ name }) => name.startsWith('sb-') && name.includes('auth-token'));
}

/**
 * The signed-in Supabase user, or null.
 *
 * Never returns a demo user. Demo mode is not authentication, and anything that
 * acts on this value — writes, payments, anything billed or persisted — is acting
 * for a real account. Rendering demo content is `getViewer()`.
 */
export const getRealUser = cache(async (): Promise<User | null> => {
  const cookieStore = await cookies();

  if (!hasSupabaseAuthCookie(cookieStore)) {
    return null;
  }

  const supabase = await createClient();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const {
      data: { user },
    } = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Supabase auth timeout')), 1500);
      }),
    ]);

    return user;
  } catch {
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
});

/**
 * The viewer, demo included. Only use this where showing demo content is the
 * point; the union forces the demo case to be answered explicitly.
 */
export async function getViewer(): Promise<Viewer> {
  if (await isDemoMode()) {
    return {
      status: 'demo',
      user: { id: DEMO_USER_ID, email: DEMO_USER_EMAIL },
    };
  }

  const user = await getRealUser();

  return user ? { status: 'authenticated', user } : { status: 'anonymous' };
}

/** Real authentication only — demo mode is not signed in. */
export async function isAuthenticated(): Promise<boolean> {
  return Boolean(await getRealUser());
}
