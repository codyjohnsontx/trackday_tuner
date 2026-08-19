import { NextResponse } from 'next/server';
import { sanitizeNextPath } from '@/lib/auth/redirects';
import { DEMO_COOKIE_NAME } from '@/lib/demo/mode';

/**
 * Leave the demo.
 *
 * `next` is for the one caller that has somewhere specific to be: a rider who
 * followed a password-reset link into the demo. `/auth/callback` signed them in
 * before `/reset-password` ever rendered, so dropping them on the default
 * `/login` strands them - it forwards anyone already signed in to `/dashboard`,
 * which has no route back to the reset form and no mention that they were in the
 * middle of one. The demo banner and the app menu pass nothing and still land on
 * `/login`, which is right for them: leaving the demo is all they asked for.
 */
export function GET(request: Request) {
  const next = sanitizeNextPath(new URL(request.url).searchParams.get('next'), '/login');

  const response = NextResponse.redirect(new URL(next, request.url));
  response.cookies.delete(DEMO_COOKIE_NAME);
  return response;
}
