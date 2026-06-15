import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/env.public';
import type { Database } from '@/types/supabase';

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies.getAll().some(({ name }) => name.startsWith('sb-') && name.includes('auth-token'));
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  if (!hasSupabaseAuthCookie(request)) {
    return response;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      supabase.auth.getUser(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Supabase auth timeout')), 1500);
      }),
    ]);
  } catch {
    // Keep public routes available when Supabase is unreachable in local dev.
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  return response;
}
