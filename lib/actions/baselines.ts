'use server';

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUser } from '@/lib/auth';
import { getUserProfile } from '@/lib/actions/vehicles';
import { resolveUserAccess } from '@/lib/access';
import { getDemoVehicleBaseline, getDemoVehicleBaselines } from '@/lib/demo/data';
import { assertNotDemoMode, isDemoMode } from '@/lib/demo/mode';
import { createClient } from '@/lib/supabase/server';
import type { TableInsert } from '@/types/supabase';
import type { ActionResult, Session, VehicleBaseline } from '@/types';

export async function getVehicleBaseline(vehicleId: string): Promise<VehicleBaseline | null> {
  if (await isDemoMode()) {
    return getDemoVehicleBaseline(vehicleId);
  }

  const user = await getAuthenticatedUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from('vehicle_baselines')
    .select('*')
    .eq('user_id', user.id)
    .eq('vehicle_id', vehicleId)
    .limit(1);

  return ((data ?? [])[0] ?? null) as VehicleBaseline | null;
}

export async function getVehicleBaselines(vehicleIds: string[]): Promise<VehicleBaseline[]> {
  if (vehicleIds.length === 0) return [];

  if (await isDemoMode()) {
    return getDemoVehicleBaselines(vehicleIds);
  }

  const user = await getAuthenticatedUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from('vehicle_baselines')
    .select('*')
    .eq('user_id', user.id)
    .in('vehicle_id', vehicleIds);

  return (data ?? []) as VehicleBaseline[];
}

export async function setVehicleBaselineFromSession(sessionId: string): Promise<ActionResult<VehicleBaseline>> {
  const demoError = await assertNotDemoMode<VehicleBaseline>();
  if (demoError) return demoError;

  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const profile = await getUserProfile();
  if (!resolveUserAccess(profile).hasProAccess) {
    return { ok: false, error: 'Vehicle baselines are a Pro feature.' };
  }

  const supabase = await createClient();

  const { data: sessionData, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (sessionError || !sessionData) return { ok: false, error: 'Session not found.' };

  const session = sessionData as Session;
  const { data: vehicleData, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id')
    .eq('id', session.vehicle_id)
    .eq('user_id', user.id)
    .single();

  if (vehicleError || !vehicleData) return { ok: false, error: 'Vehicle not found.' };

  const payload: TableInsert<'vehicle_baselines'> = {
    user_id: user.id,
    vehicle_id: session.vehicle_id,
    source_session_id: session.id,
    source_track_id: session.track_id,
    source_track_name: session.track_name,
    source_date: session.date,
    source_start_time: session.start_time,
    source_session_number: session.session_number,
    source_conditions: session.conditions,
    tires: session.tires,
    suspension: session.suspension,
    alignment: session.alignment,
    enabled_modules: session.enabled_modules ?? {},
    extra_modules: session.extra_modules,
    notes: session.notes,
  };

  const { data, error } = await supabase
    .from('vehicle_baselines')
    .upsert(payload, { onConflict: 'user_id,vehicle_id' })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/garage');
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath(`/sessions/${sessionId}/compare`);

  return { ok: true, data: data as VehicleBaseline };
}

export async function clearVehicleBaseline(vehicleId: string): Promise<ActionResult> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const profile = await getUserProfile();
  if (!resolveUserAccess(profile).hasProAccess) {
    return { ok: false, error: 'Vehicle baselines are a Pro feature.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vehicle_baselines')
    .delete()
    .eq('user_id', user.id)
    .eq('vehicle_id', vehicleId)
    .select('source_session_id');

  if (error) return { ok: false, error: error.message };

  revalidatePath('/garage');

  const deletedBaseline = ((data ?? [])[0] ?? null) as Pick<VehicleBaseline, 'source_session_id'> | null;
  if (deletedBaseline?.source_session_id) {
    revalidatePath(`/sessions/${deletedBaseline.source_session_id}`);
    revalidatePath(`/sessions/${deletedBaseline.source_session_id}/compare`);
  }

  return { ok: true, data: undefined };
}
