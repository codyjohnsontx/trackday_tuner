'use server';

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getTracks } from '@/lib/actions/sessions';
import type { ActionResult, Track } from '@/types';

export { getTracks };

export async function createTrack(input: {
  name: string;
  location?: string | null;
}): Promise<ActionResult<Track>> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Track name is required.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tracks')
    .insert({
      name,
      location: input.location?.trim() || null,
      is_seeded: false,
      created_by: user.id,
    })
    .select('*')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/tracks');
  revalidatePath('/sessions/new');

  return { ok: true, data: data as Track };
}
