import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

export function hasServiceRole(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Service-role client for e2e assertions that have to look past the UI.
 *
 * `lib/supabase/admin.ts` cannot be reused here: it pulls in `lib/env.server.ts`,
 * which imports `server-only` and therefore refuses to load in the Playwright
 * process.
 */
export function createTestAdminClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Last resort for cleanup when the id was never captured.
 *
 * `listUsers()` is paginated and takes no email argument, so reading page one is
 * not a lookup - it is a coin flip that gets quieter the more accounts the
 * database holds, and a cleanup that silently finds nothing is worse than none.
 * Page until the address turns up or the list runs out.
 */
export async function findUserIdByEmail(
  admin: SupabaseClient<Database>,
  email: string,
): Promise<string | null> {
  const perPage = 200;
  const wanted = email.toLowerCase();

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) return null;

    const match = data.users.find((user) => user.email?.toLowerCase() === wanted);
    if (match) return match.id;
    if (data.users.length < perPage) return null;
  }

  return null;
}
