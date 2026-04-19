import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl } from '@/lib/env.public';
import { getSupabaseServiceRoleKey } from '@/lib/env.server';
import type { Database } from '@/types/supabase';

export function createAdminClient() {
  return createClient<Database>(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
