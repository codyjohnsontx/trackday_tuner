'use server';

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getUserProfile } from '@/lib/actions/vehicles';
import type { ActionResult, CreateSessionInput, Session, Track } from '@/types';

export async function getTracks(): Promise<Track[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('tracks')
    .select('*')
    .order('name', { ascending: true });

  return (data as Track[]) ?? [];
}

export async function getSessions(vehicleId?: string): Promise<Session[]> {
  const user = await getAuthenticatedUser();
  if (!user) return [];

  const supabase = await createClient();
  let query = supabase
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false });

  if (vehicleId) {
    query = query.eq('vehicle_id', vehicleId);
  }

  const { data } = await query;
  return (data as Session[]) ?? [];
}

export async function getSession(id: string): Promise<Session | null> {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error) return null;
  return data as Session;
}

export async function createSession(
  input: CreateSessionInput,
): Promise<ActionResult<Session>> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();

  const profile = await getUserProfile();
  const tier = profile?.tier ?? 'free';

  if (tier === 'free') {
    const { count } = await supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if ((count ?? 0) >= 10) {
      return {
        ok: false,
        error:
          'Free plan is limited to 10 sessions. Upgrade to Pro for unlimited sessions.',
      };
    }
  }

  // Denormalize track name if track_id is set but track_name was not provided
  let trackName = input.track_name;
  if (input.track_id && !trackName) {
    const { data: trackData } = await supabase
      .from('tracks')
      .select('name')
      .eq('id', input.track_id)
      .single();
    trackName = trackData?.name ?? null;
  }

  const { data, error } = await supabase
    .from('sessions')
    .insert({
      user_id: user.id,
      vehicle_id: input.vehicle_id,
      track_id: input.track_id,
      track_name: trackName,
      date: input.date,
      conditions: input.conditions,
      tires: input.tires,
      suspension: input.suspension,
      alignment: input.alignment,
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/sessions');
  revalidatePath('/dashboard');
  return { ok: true, data: data as Session };
}

export async function deleteSession(id: string): Promise<ActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/sessions');
  return { ok: true, data: undefined };
}
