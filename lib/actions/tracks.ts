'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { getAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getTracks } from '@/lib/actions/sessions';
import { getUserProfile } from '@/lib/actions/vehicles';
import type { ActionResult, Track } from '@/types';

export { getTracks };

async function getTrackForUser(id: string, userId: string): Promise<Track | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tracks')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;

  const track = data as Track;
  if (track.is_seeded || track.created_by === userId) {
    return track;
  }

  return null;
}

export async function createTrack(input: {
  name: string;
  location?: string | null;
}): Promise<ActionResult<Track>> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Track name is required.' };

  const supabase = await createClient();
  const profile = await getUserProfile();
  const tier = profile?.tier ?? 'free';

  if (tier === 'free') {
    const { count } = await supabase
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', user.id)
      .eq('is_seeded', false);

    if ((count ?? 0) >= 3) {
      return {
        ok: false,
        error: 'Free plan is limited to 3 tracks. Upgrade to Pro for unlimited tracks.',
      };
    }
  }

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

  revalidateTag('tracks');
  revalidatePath('/tracks');
  revalidatePath('/sessions/new');

  return { ok: true, data: data as Track };
}

export async function getTrack(id: string): Promise<ActionResult<Track>> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const track = await getTrackForUser(id, user.id);
  if (!track) return { ok: false, error: 'Track not found.' };

  return { ok: true, data: track };
}

export async function updateTrack(
  id: string,
  input: { name: string; location?: string | null },
): Promise<ActionResult<Track>> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Track name is required.' };

  const existingTrack = await getTrackForUser(id, user.id);
  if (!existingTrack) return { ok: false, error: 'Track not found.' };
  if (existingTrack.is_seeded) return { ok: false, error: 'Global tracks are read-only.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tracks')
    .update({
      name,
      location: input.location?.trim() || null,
    })
    .eq('id', id)
    .eq('created_by', user.id)
    .eq('is_seeded', false)
    .select('*')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'Track not found.' };

  revalidateTag('tracks');
  revalidatePath('/tracks');
  revalidatePath(`/tracks/${id}`);
  revalidatePath('/sessions/new');

  return { ok: true, data: data as Track };
}

export async function deleteTrack(id: string): Promise<ActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const existingTrack = await getTrackForUser(id, user.id);
  if (!existingTrack) return { ok: false, error: 'Track not found.' };
  if (existingTrack.is_seeded) return { ok: false, error: 'Global tracks are read-only.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('tracks')
    .delete()
    .eq('id', id)
    .eq('created_by', user.id)
    .eq('is_seeded', false);

  if (error) return { ok: false, error: error.message };

  revalidateTag('tracks');
  revalidatePath('/tracks');
  revalidatePath('/sessions/new');

  return { ok: true, data: undefined };
}
