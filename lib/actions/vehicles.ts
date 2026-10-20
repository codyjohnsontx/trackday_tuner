'use server';

import { revalidatePath } from 'next/cache';
import { getRealUser } from '@/lib/auth';
import { getDemoProfile, getDemoVehicles } from '@/lib/demo/data';
import { assertNotDemoMode, isDemoMode } from '@/lib/demo/mode';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getFreePlanLimit, getFreePlanLimitMessage } from '@/lib/plans';
import { resolveUserAccess } from '@/lib/access';
import { reportError } from '@/lib/monitoring/report-error';
import {
  VEHICLE_DELETE_ATTACHMENTS_FAILED_MESSAGE,
  VEHICLE_DELETE_COUNT_CHANGED_AFTER_PHOTOS_MESSAGE,
  VEHICLE_DELETE_COUNT_CHANGED_MESSAGE,
  VEHICLE_DELETE_COUNT_FAILED_MESSAGE,
  VEHICLE_DELETE_FAILED_AFTER_PHOTOS_MESSAGE,
  VEHICLE_DELETE_FAILED_MESSAGE,
  VEHICLE_DELETE_NOT_FOUND_MESSAGE,
  VEHICLE_DELETE_SESSION_PHOTOS_FAILED_MESSAGE,
  VEHICLE_PHOTO_BUCKET,
  type VehicleDeletionCounts,
} from '@/lib/vehicle-delete';
import { SESSION_PHOTO_BUCKET, sessionPhotoObjectPath } from '@/lib/session-delete';
import { removeKnownObjects, removeOwnedPhotos } from '@/lib/storage-photo-removal';
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
      .eq('user_id', user.id)
      // A bike handed to a buyer no longer counts (vehiclesTowardPlan).
      .is('sold_at', null);

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
/** A session the bike's delete would cascade, as read: what its photo removal and the delete's re-check both use. */
type CascadedSession = { id: string; photo_url: string | null };

/** `delete_vehicle_if_sessions_unchanged` found the bike's sessions changed since they were read. */
const SESSIONS_CHANGED_CODE = 'TT409';

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
): Promise<
  { ok: true; counts: VehicleDeletionCounts; sessions: CascadedSession[] } | { ok: false; error: CountError }
> {
  const sessions: CascadedSession[] = [];
  let planSessionCount = 0;
  for (let from = 0; ; from += SESSION_ID_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('sessions')
      .select('id, photo_url, copied_from_session_id, original_user_id')
      .eq('user_id', userId)
      .eq('vehicle_id', vehicleId)
      .order('id')
      .range(from, from + SESSION_ID_PAGE_SIZE - 1);
    if (error) return { ok: false, error };
    const page = (data ?? []) as (CascadedSession & {
      copied_from_session_id: string | null;
      original_user_id: string | null;
    })[];
    sessions.push(...page.map((row) => ({ id: row.id, photo_url: row.photo_url ?? null })));
    planSessionCount += page.filter(
      (row) => !row.copied_from_session_id || row.original_user_id === userId,
    ).length;
    if (page.length < SESSION_ID_PAGE_SIZE) break;
  }
  const sessionIds = sessions.map((session) => session.id);

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
      planSessionCount,
      lapCount,
      hasBaseline: (baselineCount ?? 0) > 0,
      recommendationCount,
      hasRaceEngineerMemory: (memoryCount ?? 0) > 0,
    },
    sessions,
  };
}

const ATTACHMENT_PAGE_SIZE = 1000;

/**
 * Every object the bike's service book attachments name - receipts, invoices,
 * photos and their thumbnails, confirmed or still pending - read as the rider so
 * RLS decides. A bike with no book has none.
 */
async function readServiceBookObjects(
  supabase: SupabaseServerClient,
  vehicleId: string,
): Promise<{ ok: true; objects: string[] } | { ok: false; error: CountError }> {
  const { data: book, error: bookError } = await supabase
    .from('service_books')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .maybeSingle();
  if (bookError) return { ok: false, error: bookError };
  if (!book) return { ok: true, objects: [] };

  const objects: string[] = [];
  for (let from = 0; ; from += ATTACHMENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('service_attachments')
      .select('object_path, thumb_path')
      .eq('book_id', book.id)
      .order('id')
      .range(from, from + ATTACHMENT_PAGE_SIZE - 1);
    if (error) return { ok: false, error };
    const page = data ?? [];
    for (const row of page) {
      objects.push(row.object_path);
      if (row.thumb_path) objects.push(row.thumb_path);
    }
    if (page.length < ATTACHMENT_PAGE_SIZE) break;
  }
  return { ok: true, objects };
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
 * deleted under a confirmation that never mentioned it.
 *
 * Session photos go first (owner's decision, 2026-09-26): every cascaded
 * session's photo is removed from the public bucket, and the bike is deleted
 * only once Storage has confirmed all of them. The delete itself is
 * `delete_vehicle_if_sessions_unchanged` (20260926002100), which locks the bike
 * and its sessions and refuses unless they are exactly the ones read here, as
 * (id, photo_url) pairs - so a new session, or a photo under a new URL, synced
 * after that read keeps the bike. A photo uploaded to a session's fixed path
 * without changing its URL is invisible to that check, so each cascaded
 * session's path is removed once more after the delete, best effort.
 *
 * The service book's receipts, invoices and photos go first in the same way:
 * every object its attachment rows name is removed from the private bucket, and
 * the bike stays until Storage has confirmed all of them. An upload that lands
 * between that read and the delete is left for the attachment object sweep
 * (`/api/monitoring/service-attachment-sweep`), which removes any object no
 * attachment names once it is a day old.
 */
export async function deleteVehicle(
  id: string,
  expectedSessionCount: number,
): Promise<ActionResult<{ sessionPhotoCleanupFailed: boolean }>> {
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

  const serviceBook = await readServiceBookObjects(supabase, id);
  if (!serviceBook.ok) {
    reportError('vehicle-delete', new Error(serviceBook.error.message), {
      reason: serviceBook.error.code,
      query: 'service-book-objects',
      details: serviceBook.error.details,
      hint: serviceBook.error.hint,
      userId: user.id,
      vehicleId: id,
    });
    return { ok: false, error: VEHICLE_DELETE_FAILED_MESSAGE };
  }

  const photosRemoved = await removeOwnedPhotos(supabase, {
    bucket: SESSION_PHOTO_BUCKET,
    photoUrls: recount.sessions.map((session) => session.photo_url),
    ownerId: user.id,
    event: 'session-photo-delete',
    context: { vehicleId: id },
  });
  if (!photosRemoved) return { ok: false, error: VEHICLE_DELETE_SESSION_PHOTOS_FAILED_MESSAGE };

  const attachmentsRemoved =
    serviceBook.objects.length === 0 ||
    (await removeKnownObjects(createAdminClient(), {
      bucket: 'service-book',
      objects: serviceBook.objects,
      ownerId: user.id,
      event: 'service-attachment-delete',
      context: { vehicleId: id },
    }));
  if (!attachmentsRemoved) return { ok: false, error: VEHICLE_DELETE_ATTACHMENTS_FAILED_MESSAGE };
  const filesRemoved =
    recount.sessions.some((session) => session.photo_url !== null) || serviceBook.objects.length > 0;

  // RLS and the user_id check inside the function turn another rider's id, or a
  // vehicle already gone, into null rather than an error.
  const { data, error } = await supabase.rpc('delete_vehicle_if_sessions_unchanged', {
    p_vehicle_id: id,
    p_expected_sessions: recount.sessions,
  });

  if (error?.code === SESSIONS_CHANGED_CODE) {
    return {
      ok: false,
      error: filesRemoved ? VEHICLE_DELETE_COUNT_CHANGED_AFTER_PHOTOS_MESSAGE : VEHICLE_DELETE_COUNT_CHANGED_MESSAGE,
    };
  }
  if (error) {
    reportError('vehicle-delete', new Error(error.message), {
      reason: error.code,
      table: 'vehicles',
      details: error.details,
      hint: error.hint,
      userId: user.id,
      vehicleId: id,
    });
    return { ok: false, error: filesRemoved ? VEHICLE_DELETE_FAILED_AFTER_PHOTOS_MESSAGE : VEHICLE_DELETE_FAILED_MESSAGE };
  }
  const deleted = data as { id: string; photo_url: string | null } | null;
  if (!deleted) return { ok: false, error: VEHICLE_DELETE_NOT_FOUND_MESSAGE };

  const sessionPhotosSwept = await removeKnownObjects(supabase, {
    bucket: SESSION_PHOTO_BUCKET,
    objects: recount.sessions.map((session) => sessionPhotoObjectPath(user.id, session.id)),
    ownerId: user.id,
    event: 'session-photo-delete',
    context: { vehicleId: id },
  });

  // The bike's own photo is still removed after its row, and a failure there is
  // reported rather than undoing a delete that happened.
  await removeOwnedPhotos(supabase, {
    bucket: VEHICLE_PHOTO_BUCKET,
    photoUrls: [deleted.photo_url],
    ownerId: user.id,
    event: 'vehicle-photo-delete',
    context: { vehicleId: id },
  });

  // The cascade reaches every screen that lists sessions or picks a vehicle.
  revalidatePath('/garage');
  revalidatePath('/dashboard');
  revalidatePath('/sessions');
  revalidatePath('/sessions/new');
  revalidatePath('/tracks');
  return { ok: true, data: { sessionPhotoCleanupFailed: !sessionPhotosSwept } };
}
