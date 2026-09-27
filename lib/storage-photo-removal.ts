import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseUrl } from '@/lib/env.public';
import { reportError } from '@/lib/monitoring/report-error';
import { PUBLIC_OBJECT_ENDPOINT } from '@/lib/supabase-storage-remote-patterns';

/**
 * The object a stored public photo URL points at, for a delete to remove.
 *
 * `vehicles.photo_url` and `sessions.photo_url` are columns `authenticated`
 * writes directly, so the value is the rider's and not the app's, and what this
 * returns is fed to a destructive storage call. It is therefore anchored rather
 * than scanned: the URL has to be this project's own public object endpoint for
 * this bucket, built the way supabase-js builds it, and the object has to sit in
 * the owner's folder. A URL naming another project, another bucket or another
 * rider's folder is `null`, which deletes nothing and still deletes the row.
 * supabase-js runs the whole URL through `encodeURI`, so each segment is decoded
 * back to the name the object was uploaded under.
 */
export function ownedPublicObjectPath(
  photoUrl: string | null | undefined,
  { supabaseUrl, ownerId, bucket }: { supabaseUrl: string; ownerId: string; bucket: string },
): string | null {
  if (!photoUrl || !ownerId) return null;

  let prefix: URL;
  let parsed: URL;
  try {
    const base = new URL(supabaseUrl.endsWith('/') ? supabaseUrl : `${supabaseUrl}/`);
    prefix = new URL(`${PUBLIC_OBJECT_ENDPOINT}${bucket}/`, base);
    parsed = new URL(photoUrl);
  } catch {
    return null;
  }

  if (parsed.origin !== prefix.origin) return null;
  if (!parsed.pathname.startsWith(prefix.pathname)) return null;

  const segments = parsed.pathname.slice(prefix.pathname.length).split('/').filter((segment) => segment !== '');
  if (segments.length < 2) return null;

  let object: string[];
  try {
    object = segments.map(decodeURIComponent);
  } catch {
    return null;
  }
  if (object[0] !== ownerId) return null;

  return object.join('/');
}

/**
 * The most objects one `remove` call may name. Supabase documents this cap for
 * the hosted Storage API (https://supabase.com/docs/guides/storage/management/delete-objects);
 * the local stack does not enforce it, so nothing short of a rider with more
 * sessions than this on one bike would show a single oversized call failing.
 */
export const STORAGE_REMOVE_BATCH_LIMIT = 1000;

/**
 * Remove the photos a delete is about to orphan, and say whether Storage
 * confirmed it.
 *
 * The buckets are public, so a photo left behind keeps serving a bike or a
 * session a rider was told is gone. Session photos are removed BEFORE their rows
 * (owner's decision, 2026-09-26): the answer is `true` only when every batch came
 * back without an error, and a caller keeps the row on `false` so the rider can
 * try again with nothing orphaned; `removeObjectsAfterDelete` then sweeps their
 * fixed paths once the rows are gone. The bike's own photo is still removed
 * after its row, and that caller ignores the answer.
 *
 * `remove` deletes what RLS admits and reports what it deleted, so an object
 * already gone comes back missing from the result rather than as an error. That
 * still counts as confirmed - there is nothing left to serve - and is reported
 * so a policy quietly refusing the rider's own folder would still be seen. A URL
 * that is not an object in the rider's own folder is reported and skipped: there
 * is nothing of theirs to remove, and refusing on it would let one odd value
 * make a row undeletable.
 *
 * Objects go to Storage in batches of at most `STORAGE_REMOVE_BATCH_LIMIT`, and
 * each batch stands alone: a batch that errors or throws is reported object by
 * object and the batches after it still run.
 */
export async function removeOwnedPhotos(
  supabase: Pick<SupabaseClient, 'storage'>,
  {
    bucket,
    photoUrls,
    ownerId,
    event,
    context,
  }: {
    bucket: string;
    photoUrls: (string | null | undefined)[];
    ownerId: string;
    event: string;
    context: Record<string, unknown>;
  },
): Promise<boolean> {
  const stored = photoUrls.filter((photoUrl): photoUrl is string => Boolean(photoUrl));
  if (stored.length === 0) return true;

  const supabaseUrl = getSupabaseUrl();
  const objects = new Set<string>();
  for (const photoUrl of stored) {
    const object = ownedPublicObjectPath(photoUrl, { supabaseUrl, ownerId, bucket });
    if (object) {
      objects.add(object);
    } else {
      reportError(event, new Error("photo_url is not an object in this rider's folder"), {
        bucket,
        photoUrl,
        userId: ownerId,
        ...context,
      });
    }
  }

  const { missing, failed } = await removeObjects(supabase, bucket, [...objects]);
  for (const object of missing) {
    reportError(event, new Error('storage removed no object'), { bucket, object, userId: ownerId, ...context });
  }
  reportFailures(failed, { bucket, event, ownerId, context });
  return failed.length === 0;
}

/**
 * Remove objects at known paths once their rows are already gone, and say
 * whether Storage confirmed it.
 *
 * A session photo lives at the one path `sessionPhotoObjectPath` derives, and a
 * phone can upload to it between the removal before a delete and the delete
 * itself - with the same URL, or onto a session whose `photo_url` was still null
 * when it was read - so the delete's own check cannot see it. This second pass
 * removes that path again after the delete. It is best effort: an object that
 * is not there is the ordinary case and is not reported, a failure is reported,
 * and nothing here can undo the delete, so the caller only passes the answer on.
 */
export async function removeObjectsAfterDelete(
  supabase: Pick<SupabaseClient, 'storage'>,
  {
    bucket,
    objects,
    ownerId,
    event,
    context,
  }: {
    bucket: string;
    objects: string[];
    ownerId: string;
    event: string;
    context: Record<string, unknown>;
  },
): Promise<boolean> {
  if (objects.length === 0) return true;
  const { failed } = await removeObjects(supabase, bucket, [...new Set(objects)]);
  reportFailures(failed, { bucket, event, ownerId, context });
  return failed.length === 0;
}

type ObjectFailure = { object: string; message: string };

async function removeObjects(
  supabase: Pick<SupabaseClient, 'storage'>,
  bucket: string,
  objects: string[],
): Promise<{ missing: string[]; failed: ObjectFailure[] }> {
  const missing: string[] = [];
  const failed: ObjectFailure[] = [];
  for (let start = 0; start < objects.length; start += STORAGE_REMOVE_BATCH_LIMIT) {
    const batch = objects.slice(start, start + STORAGE_REMOVE_BATCH_LIMIT);
    let removed = new Set<string>();
    let failure: string | null = null;
    try {
      const { data, error } = await supabase.storage.from(bucket).remove(batch);
      if (error) failure = error.message;
      removed = new Set((data ?? []).map((entry) => entry.name));
    } catch (thrown) {
      failure = thrown instanceof Error ? thrown.message : String(thrown);
    }
    for (const object of batch) {
      if (failure !== null) failed.push({ object, message: failure });
      else if (!removed.has(object)) missing.push(object);
    }
  }
  return { missing, failed };
}

function reportFailures(
  failed: ObjectFailure[],
  { bucket, event, ownerId, context }: { bucket: string; event: string; ownerId: string; context: Record<string, unknown> },
) {
  for (const { object, message } of failed) {
    reportError(event, new Error(message), { bucket, object, userId: ownerId, ...context });
  }
}
