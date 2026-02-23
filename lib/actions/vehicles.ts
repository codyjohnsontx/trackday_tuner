'use server';

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult, CreateVehicleInput, UpdateVehicleInput, Profile, Vehicle } from '@/types';

export async function getVehicles(): Promise<Vehicle[]> {
  const user = await getAuthenticatedUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from('vehicles')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  return (data as Vehicle[]) ?? [];
}

export async function getUserProfile(): Promise<Profile | null> {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return (data as Profile) ?? null;
}

export async function createVehicle(
  input: CreateVehicleInput,
): Promise<ActionResult<Vehicle>> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();

  const profile = await getUserProfile();
  const tier = profile?.tier ?? 'free';

  if (tier === 'free') {
    const { count } = await supabase
      .from('vehicles')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if ((count ?? 0) >= 1) {
      return {
        ok: false,
        error:
          'Free plan is limited to 1 vehicle. Upgrade to Pro for unlimited vehicles.',
      };
    }
  }

  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      user_id: user.id,
      nickname: input.nickname,
      type: input.type,
      year: input.year ?? null,
      make: input.make ?? null,
      model: input.model ?? null,
      photo_url: input.photo_url ?? null,
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/garage');
  return { ok: true, data: data as Vehicle };
}

export async function getVehicle(id: string): Promise<ActionResult<Vehicle>> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !data) return { ok: false, error: 'Vehicle not found.' };
  return { ok: true, data: data as Vehicle };
}

export async function updateVehicle(
  id: string,
  input: UpdateVehicleInput,
): Promise<ActionResult<Vehicle>> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  if (input.year !== undefined && input.year !== null) {
    if (!Number.isInteger(input.year) || input.year < 1885 || input.year > 2100) {
      return { ok: false, error: 'Please enter a valid year.' };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vehicles')
    .update(input)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/garage');
  return { ok: true, data: data as Vehicle };
}

export async function deleteVehicle(id: string): Promise<ActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('vehicles')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/garage');
  return { ok: true, data: undefined };
}
