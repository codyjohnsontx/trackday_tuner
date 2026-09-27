import { getMobileAppOrigins } from '@/lib/env.server';

/**
 * CORS for `/api/mobile/*`, which exists for exactly one browser caller: the
 * phone app's web build (the iPhone door), served from its own origin.
 *
 * The allowlist is `MOBILE_APP_ORIGINS`. A request from any other origin gets no
 * `Access-Control-Allow-Origin`, so the browser withholds the response; the
 * native app sends no `Origin` and is unaffected either way. No credentials are
 * allowed because none are used - the rider's session travels as a bearer
 * token, never as a cookie, so a page on another origin has nothing to borrow.
 */
export function allowedMobileOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  return getMobileAppOrigins().includes(origin) ? origin : null;
}

/** Headers every response carries, whether or not the origin was allowed. */
export function mobileCorsHeaders(request: Request): Record<string, string> {
  const origin = allowedMobileOrigin(request);
  // `Vary: Origin` on every answer, allowed or not, so a shared cache never
  // hands one origin's answer to another.
  return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
}

/**
 * The answer to a preflight. A disallowed origin gets a 403 with no allow
 * headers, which a browser reports as a CORS failure; an allowed one learns the
 * method and the two headers the phone sends.
 */
export function mobilePreflightResponse(request: Request, methods: readonly string[]): Response {
  const origin = allowedMobileOrigin(request);
  if (!origin) return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': [...methods, 'OPTIONS'].join(', '),
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    },
  });
}
