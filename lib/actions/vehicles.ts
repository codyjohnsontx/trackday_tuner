'use server';

import { revalidatePath } from 'next/cache';
import { getRealUser } from '@/lib/auth';
import { getDemoProfile, getDemoVehicles } from '@/lib/demo/data';
import { assertNotDemoMode, isDemoMode } from '@/lib/demo/mode';
import { createClient } from '@/lib/supabase/server';
import { getFreePlanLimit, getFreePlanLimitMessage } from '@/lib/plans';
import { resolveUserAccess } from '@/lib/access';
import { reportError } from '@/lib/monitoring/report-error';
import {
  VEHICLE_DELETE_COUNT_CHANGED_MESSAGE,
  VEHICLE_DELETE_COUNT_FAILED_MESSAGE,
  VEHICLE_DELETE_FAILED_MESSAGE,
  VEHICLE_DELETE_NOT_FOUND_MESSAGE,
  VEHICLE_PHOTO_BUCKET,
  vehiclePhotoObjectPath,
  type VehicleDeletionCounts,
} from '@/lib/vehicle-delete';
import type { TableInsert } from '@/types/supabase';
import type { ActionResult, CreateVehicleInput, UpdateVehicleInput, Profile, Vehicle } from '@/types';

export async function getVehicles(): Promise<Vehicle[]> {
  if (await isDemoMode()) {
    return getDemoVehicles();
  }

  const user = await getRealUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from('vehicles')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  return (data ?? []) as Vehicle[];
}

export async function getUserProfile(): Promise<Profile | null> {
  if (await isDemoMode()) {
    return getDemoProfile();
  }

  const user = await getRealUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return (data as Profile | null) ?? null;
}

export async function createVehicle(
  input: CreateVehicleInput,
): Promise<ActionResult<Vehicle>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();

  const profile = await getUserProfile();
  if (!resolveUserAccess(profile).hasProAccess) {
    const { count } = await supabase
      .from('vehicles')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if ((count ?? 0) >= getFreePlanLimit('vehicles')) {
      return {
        ok: false,
        error: getFreePlanLimitMessage('vehicles'),
      };
    }
  }

  const payload: TableInsert<'vehicles'> = {
    user_id: user.id,
    nickname: input.nickname,
    type: input.type,
    year: input.year ?? null,
    make: input.make ?? null,
    model: input.model ?? null,
    photo_url: input.photo_url ?? null,
  };

  const { data, error } = await supabase
    .from('vehicles')
    .insert(payload)
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/garage');
  return { ok: true, data: data as Vehicle };
}

export async function getVehicle(id: string): Promise<ActionResult<Vehicle>> {
  if (await isDemoMode()) {
    const vehicle = getDemoVehicles().find((demoVehicle) => demoVehicle.id === id);
    return vehicle ? { ok: true, data: vehicle } : { ok: false, error: 'Vehicle not found.' };
  }

  const user = await getRealUser();
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
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
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

const SESSION_ID_PAGE_SIZE = 1000;
const LAP_COUNT_BATCH_SIZE = 100;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type CountError = { message: string; code?: string; details?: string | null; hint?: string | null };

/**
 * Every session, lap and Race Engineer record the cascade would take with this
 * vehicle.
 *
 * `session_laps` carries no vehicle id, so the laps are counted over the
 * vehicle's session ids. Both reads are paged: PostgREST truncates a select at
 * its row limit, and a truncated id list would understate the laps in the one
 * confirmation that has to be exact.
 */
async function countVehicleCascade(
  supabase: SupabaseServerClient,
  userId: string,
  vehicleId: string,
): Promise<{ ok: true; counts: VehicleDeletionCounts } | { ok: false; error: CountError }> {
  const sessionIds: string[] = [];
  for (let from = 0; ; from += SESSION_ID_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('vehicle_id', vehicleId)
      .order('id')
      .range(from, from + SESSION_ID_PAGE_SIZE - 1);
    if (error) return { ok: false, error };
    const page = (data ?? []) as { id: string }[];
    sessionIds.push(...page.map((row) => row.id));
    if (page.length < SESSION_ID_PAGE_SIZE) break;
  }

  let lapCount = 0;
  for (let start = 0; start < sessionIds.length; start += LAP_COUNT_BATCH_SIZE) {
    const { count, error } = await supabase
      .from('session_laps')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('session_id', sessionIds.slice(start, start + LAP_COUNT_BATCH_SIZE));
    if (error) return { ok: false, error };
    if (count == null) return { ok: false, error: { message: 'session_laps count came back empty' } };
    lapCount += count;
  }

  const { count: baselineCount, error: baselineError } = await supabase
    .from('vehicle_baselines')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('vehicle_id', vehicleId);
  if (baselineError) return { ok: false, error: baselineError };

  const { count: recommendationCount, error: recommendationError } = await supabase
    .from('ai_recommendations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('vehicle_id', vehicleId);
  if (recommendationError) return { ok: false, error: recommendationError };
  if (recommendationCount == null) {
    return { ok: false, error: { message: 'ai_recommendations count came back empty' } };
  }

  const { count: memoryCount, error: memoryError } = await supabase
    .from('race_engineer_memory')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('vehicle_id', vehicleId);
  if (memoryError) return { ok: false, error: memoryError };

  return {
    ok: true,
    counts: {
      sessionCount: sessionIds.length,
      lapCount,
      hasBaseline: (baselineCount ?? 0) > 0,
      recommendationCount,
      hasRaceEngineerMemory: (memoryCount ?? 0) > 0,
    },
  };
}

function reportCountFailure(error: CountError, userId: string, vehicleId: string) {
  reportError('vehicle-delete-count', new Error(error.message), {
    reason: error.code,
    query: 'vehicle-cascade-count',
    details: error.details,
    hint: error.hint,
    userId,
    vehicleId,
  });
}

/**
 * What deleting this vehicle would remove, for the confirmation to state.
 *
 * A failed count is an error rather than zeros: "no sessions are logged on it"
 * over a bike carrying a season of them is the one misreading this confirmation
 * exists to prevent.
 */
export async function getVehicleDeletionCounts(vehicleId: string): Promise<ActionResult<VehicleDeletionCounts>> {
  const demoError = await assertNotDemoMode<VehicleDeletionCounts>();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();
  const result = await countVehicleCascade(supabase, user.id, vehicleId);
  if (!result.ok) {
    reportCountFailure(result.error, user.id, vehicleId);
    return { ok: false, error: VEHICLE_DELETE_COUNT_FAILED_MESSAGE };
  }
  return { ok: true, data: result.counts };
}

/**
 * Delete a vehicle and, through the foreign-key cascade, every session on it.
 *
 * `expectedSessionCount` is the count the rider was shown. It is checked again
 * here so a session logged from another tab after the page loaded cannot be
 * deleted under a confirmation that never mentioned it. The check and the delete
 * are two statements, so this narrows that window rather than closing it.
 */
export async function deleteVehicle(id: string, expectedSessionCount: number): Promise<ActionResult> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();
  const recount = await countVehicleCascade(supabase, user.id, id);
  if (!recount.ok) {
    reportCountFailure(recount.error, user.id, id);
    return { ok: false, error: VEHICLE_DELETE_FAILED_MESSAGE };
  }
  if (recount.counts.sessionCount !== expectedSessionCount) {
    return { ok: false, error: VEHICLE_DELETE_COUNT_CHANGED_MESSAGE };
  }

  // The deleted rows are selected back because RLS and the user_id filter turn
  // another rider's id, or a vehicle already gone, into zero rows, not an error.
  const { data, error } = await supabase
    .from('vehicles')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, photo_url');

  if (error) {
    reportError('vehicle-delete', new Error(error.message), {
      reason: error.code,
      table: 'vehicles',
      details: error.details,
      hint: error.hint,
      userId: user.id,
      vehicleId: id,
    });
    return { ok: false, error: VEHICLE_DELETE_FAILED_MESSAGE };
  }
  const deleted = (data ?? []) as { id: string; photo_url: string | null }[];
  if (deleted.length === 0) return { ok: false, error: VEHICLE_DELETE_NOT_FOUND_MESSAGE };

  // The bucket is public, so a photo left behind keeps serving the bike a rider
  // was told is gone. The row is already deleted and cannot come back, so a
  // storage failure is reported rather than failing a delete that happened.
  const photoPath = vehiclePhotoObjectPath(deleted[0].photo_url);
  if (photoPath) {
    const { error: photoError } = await supabase.storage.from(VEHICLE_PHOTO_BUCKET).remove([photoPath]);
    if (photoError) {
      reportError('vehicle-photo-delete', new Error(photoError.message), {
        bucket: VEHICLE_PHOTO_BUCKET,
        object: photoPath,
        userId: user.id,
        vehicleId: id,
      });
    }
  }

  // The cascade reaches every screen that lists sessions or picks a vehicle.
  revalidatePath('/garage');
  revalidatePath('/dashboard');
  revalidatePath('/sessions');
  revalidatePath('/sessions/new');
  revalidatePath('/tracks');
  return { ok: true, data: undefined };
}
