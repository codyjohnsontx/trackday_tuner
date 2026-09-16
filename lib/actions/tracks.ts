'use server';

import { cache } from 'react';
import { revalidatePath, revalidateTag } from 'next/cache';
import { getRealUser } from '@/lib/auth';
import { getDemoTrackLayouts, getDemoTracks } from '@/lib/demo/data';
import { assertNotDemoMode, isDemoMode } from '@/lib/demo/mode';
import { createClient } from '@/lib/supabase/server';
import { getUserProfile } from '@/lib/actions/vehicles';
import { getFreePlanLimitMessage, getFreePlanLimit } from '@/lib/plans';
import { resolveUserAccess } from '@/lib/access';
import { buildTrackAliasIndex, buildTrackLayoutIndex, type TrackDirectory } from '@/lib/track-directory';
import type { TableInsert } from '@/types/supabase';
import type { ActionResult, Track, TrackAlias, TrackLayout } from '@/types';

const getTracksForUser = cache(async (userId: string): Promise<Track[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tracks')
    .select('*')
    .or(`is_seeded.eq.true,created_by.eq.${userId}`)
    .order('name', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as Track[];
});

export async function getTracks(): Promise<Track[]> {
  if (await isDemoMode()) {
    return getDemoTracks();
  }

  const user = await getRealUser();
  if (!user) return [];

  return getTracksForUser(user.id);
}

/**
 * The circuits a rider can name, with the alternate spellings and the layouts
 * that go with them.
 *
 * One loader rather than three call sites, because the three answers only mean
 * anything together: an alias pointing at a track the caller did not read is a
 * redirect to nothing, and a layout list keyed on a track that is not in the
 * list is never offered. RLS scopes all three the same way - a layout and an
 * alias are exactly as visible as the track they hang off (20260916001600) - so
 * the three reads cannot disagree about which circuits the rider can see.
 *
 * A failed read degrades to an empty index rather than refusing: the rider can
 * still type their circuit and `resolveSessionTrack` still resolves it
 * server-side. What they lose is the typeahead offering it, which is a worse
 * form and not a lost session. See the sibling-readers note in CLAUDE.md for
 * which reads may do this and which may not.
 */
export async function getTrackDirectory(): Promise<TrackDirectory> {
  const tracks = await getTracks();
  if (await isDemoMode()) {
    return { tracks, aliases: {}, layouts: buildTrackLayoutIndex(getDemoTrackLayouts()) };
  }
  if (tracks.length === 0) return { tracks, aliases: {}, layouts: {} };

  const supabase = await createClient();
  const [aliasResult, layoutResult] = await Promise.all([
    supabase.from('track_aliases').select('*'),
    supabase.from('track_layouts').select('*'),
  ]);

  if (aliasResult.error) {
    console.error('[tracks] alias read failed', { error: aliasResult.error.message });
  }
  if (layoutResult.error) {
    console.error('[tracks] layout read failed', { error: layoutResult.error.message });
  }

  return {
    tracks,
    aliases: buildTrackAliasIndex((aliasResult.data ?? []) as TrackAlias[]),
    layouts: buildTrackLayoutIndex((layoutResult.data ?? []) as TrackLayout[]),
  };
}

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
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Track name is required.' };

  const supabase = await createClient();
  const profile = await getUserProfile();
  if (!resolveUserAccess(profile).hasProAccess) {
    const { count } = await supabase
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', user.id)
      .eq('is_seeded', false);

    if ((count ?? 0) >= getFreePlanLimit('tracks')) {
      return {
        ok: false,
        error: getFreePlanLimitMessage('tracks'),
      };
    }
  }

  const payload: TableInsert<'tracks'> = {
    name,
    location: input.location?.trim() || null,
    is_seeded: false,
    created_by: user.id,
  };

  const { data, error } = await supabase
    .from('tracks')
    .insert(payload)
    .select('*')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidateTag('tracks');
  revalidatePath('/tracks');
  revalidatePath('/sessions/new');

  return { ok: true, data: data as Track };
}

export async function getTrack(id: string): Promise<ActionResult<Track>> {
  if (await isDemoMode()) {
    const track = getDemoTracks().find((demoTrack) => demoTrack.id === id);
    return track ? { ok: true, data: track } : { ok: false, error: 'Track not found.' };
  }

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const track = await getTrackForUser(id, user.id);
  if (!track) return { ok: false, error: 'Track not found.' };

  return { ok: true, data: track };
}

export async function updateTrack(
  id: string,
  input: { name: string; location?: string | null },
): Promise<ActionResult<Track>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
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
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
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
