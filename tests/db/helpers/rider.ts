import { expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ThrowawayRider } from '@/tests/e2e/helpers/throwaway-rider';
import type { Database } from '@/types/supabase';

/**
 * Clients for the real-database suite: nobody, and a rider signed in with the
 * anon key and their own password - the same position the website's server
 * action and the phone's bearer route write from, so RLS applies as it does
 * for them.
 */

export type Client = SupabaseClient<Database>;

export function anonClient(): Client {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function signIn(rider: ThrowawayRider): Promise<Client> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email: rider.email, password: rider.password });
  expect(error, error?.message).toBeNull();
  return client;
}

export async function createVehicle(client: Client, userId: string): Promise<string> {
  const { data, error } = await client
    .from('vehicles')
    .insert({ user_id: userId, nickname: 'Test bike', make: 'Yamaha', model: 'R6', year: 2020, type: 'motorcycle' })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  return data!.id;
}
