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
 * Remove the photos of rows that are already deleted.
 *
 * The buckets are public, so a photo left behind keeps serving a bike or a
 * session a rider was told is gone. The rows cannot come back, so a storage
 * failure is reported rather than failing a delete that happened. `remove`
 * deletes what RLS admits and reports what it deleted, so an object the policy
 * refuses or one already gone comes back missing from the result and not as an
 * error - the photo still serving is exactly the case this removes.
 *
 * Objects go to Storage in batches of at most `STORAGE_REMOVE_BATCH_LIMIT`, and
 * each batch stands alone: a batch that errors or throws is reported object by
 * object and the batches after it still run, so one failure never leaves the
 * rest of a bike's photos behind.
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
): Promise<void> {
  const stored = photoUrls.filter((photoUrl): photoUrl is string => Boolean(photoUrl));
  if (stored.length === 0) return;

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

  const all = [...objects];
  for (let start = 0; start < all.length; start += STORAGE_REMOVE_BATCH_LIMIT) {
    const batch = all.slice(start, start + STORAGE_REMOVE_BATCH_LIMIT);
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
      if (failure === null && removed.has(object)) continue;
      reportError(event, new Error(failure ?? 'storage removed no object'), {
        bucket,
        object,
        userId: ownerId,
        ...context,
      });
    }
  }
}
