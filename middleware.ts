import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // `api/health` is excluded on purpose. `updateSession` reads the public Supabase
  // env vars to build a client before it can decide there is no auth cookie to
  // refresh, so a deployment missing them would answer the uptime probe with an
  // opaque 500 instead of the structured 503 that names the failing check. The
  // probe should depend on as little as possible - that is the whole point of it.
  matcher: [
    '/((?!api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
