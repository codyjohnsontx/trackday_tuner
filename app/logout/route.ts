import { NextResponse } from 'next/server';
import { sanitizeNextPath } from '@/lib/auth/redirects';
import { createClient } from '@/lib/supabase/server';

/**
 * Sign out, then sign in. `next` is for a caller the rider has to come back
 * to under another account - a handover link opened while signed in with the
 * wrong address - and is handed on to `/login`, which returns there.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const login = new URL('/login', request.url);
  const next = sanitizeNextPath(new URL(request.url).searchParams.get('next'), '');
  if (next) login.searchParams.set('next', next);
  return NextResponse.redirect(login);
}
