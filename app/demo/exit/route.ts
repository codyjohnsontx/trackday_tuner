import { NextResponse } from 'next/server';
import { DEMO_COOKIE_NAME } from '@/lib/demo/mode';

export function GET(request: Request) {
  const response = NextResponse.redirect(new URL('/', request.url));
  response.cookies.delete(DEMO_COOKIE_NAME);
  return response;
}
