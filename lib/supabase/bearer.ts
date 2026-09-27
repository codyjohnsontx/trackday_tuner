import { createClient, isAuthApiError, isAuthRetryableFetchError, type User } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/env.public';
import type { SessionWriteClient } from '@/lib/sessions/create';
import type { Database } from '@/types/supabase';

/**
 * A rider client for a request that carries its session as
 * `Authorization: Bearer <access token>` rather than as cookies - the phone app,
 * whose supabase-js keeps its own session and never shares the website's cookies.
 *
 * The client is the anon key plus the rider's token, so every query runs as that
 * rider under RLS exactly as the cookie client in `lib/supabase/server.ts` does.
 * It is never the service role: the token decides who the rider is and the
 * database decides what they may touch.
 *
 * `getUser(token)` asks GoTrue rather than decoding the JWT here, so a signed-out,
 * deleted or banned rider is refused even while their token has not expired.
 *
 * GoTrue being unreachable is `unavailable`, never `unauthenticated`. The phone
 * reads a 401 as "signed out" and stops syncing until the rider signs in again,
 * so an outage answered as one would sign every rider out of their own outbox.
 */
export type BearerAuth =
  | { status: 'authenticated'; supabase: SessionWriteClient; user: User }
  | { status: 'unauthenticated' }
  | { status: 'unavailable'; error: unknown };

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match ? match[1] : null;
}

export async function authenticateBearer(request: Request): Promise<BearerAuth> {
  const token = readBearerToken(request);
  if (!token) return { status: 'unauthenticated' };

  const supabase = createClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  let result: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    result = await supabase.auth.getUser(token);
  } catch (error) {
    return { status: 'unavailable', error };
  }

  const { data, error } = result;
  if (error) {
    if (isAuthRetryableFetchError(error)) return { status: 'unavailable', error };
    if (isAuthApiError(error) && error.status >= 500) return { status: 'unavailable', error };
    return { status: 'unauthenticated' };
  }
  if (!data.user) return { status: 'unauthenticated' };

  return { status: 'authenticated', supabase, user: data.user };
}
