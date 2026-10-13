import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { oauthProviderLabel } from '@/lib/auth/providers';
import { sanitizeNextPath } from '@/lib/auth/redirects';

// What GoTrue sends back when inserting the identity failed, which is how
// 20261004002700 refusing an unverified provider email reaches the browser.
const REFUSED_IDENTITY_DESCRIPTION = 'Error creating identity';

function refusedIdentityRedirect(requestUrl: URL): URL {
  const target = new URL('/login?error=provider_email_unverified', requestUrl.origin);
  const provider = requestUrl.searchParams.get('provider');
  if (oauthProviderLabel(provider)) target.searchParams.set('provider', provider!);
  return target;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = sanitizeNextPath(requestUrl.searchParams.get('next'));

  // Not OAuth-only: password recovery links land here too, and an expired one
  // arrives with no code at all.
  if (!code) {
    if (requestUrl.searchParams.get('error_description') === REFUSED_IDENTITY_DESCRIPTION) {
      return NextResponse.redirect(refusedIdentityRedirect(requestUrl));
    }
    return NextResponse.redirect(new URL('/login?error=auth_callback_failed', requestUrl.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL('/login?error=auth_callback_failed', requestUrl.origin));
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
