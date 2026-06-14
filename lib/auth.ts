import { cache } from 'react';
import { cookies } from 'next/headers';
import { DEMO_USER_ID, isDemoMode } from '@/lib/demo/mode';
import { createClient } from '@/lib/supabase/server';

function hasSupabaseAuthCookie(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return cookieStore.getAll().some(({ name }) => name.startsWith('sb-') && name.includes('auth-token'));
}

export const getAuthenticatedUser = cache(async () => {
  if (await isDemoMode()) {
    return {
      id: DEMO_USER_ID,
      email: 'demo@trackdaytuner.local',
    };
  }

  const cookieStore = await cookies();

  if (!hasSupabaseAuthCookie(cookieStore)) {
    return null;
  }

  const supabase = await createClient();
  try {
    const {
      data: { user },
    } = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Supabase auth timeout')), 1500);
      }),
    ]);

    return user;
  } catch {
    return null;
  }
});

export async function isAuthenticated(): Promise<boolean> {
  const user = await getAuthenticatedUser();
  return Boolean(user);
}
