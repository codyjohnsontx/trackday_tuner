import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sanitizeNextPath } from '@/lib/auth/redirects';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = sanitizeNextPath(requestUrl.searchParams.get('next'));

  // Not OAuth-only: password recovery links land here too, and an expired one
  // arrives with no code at all.
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=auth_callback_failed', requestUrl.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL('/login?error=auth_callback_failed', requestUrl.origin));
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
