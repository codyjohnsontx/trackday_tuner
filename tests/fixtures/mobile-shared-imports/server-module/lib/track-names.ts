import { createClient } from './supabase/server';

export const trackCount = 0;

export async function loadTrackNames() {
  return createClient();
}
