import { NextResponse } from 'next/server';
import { DEMO_COOKIE_NAME } from '@/lib/demo/mode';

export function GET(request: Request) {
  const response = NextResponse.redirect(new URL('/dashboard', request.url));
  response.cookies.set(DEMO_COOKIE_NAME, '1', {
    httpOnly: true,
    maxAge: 60 * 60 * 24,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}
