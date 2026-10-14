'use server';

import { revalidatePath } from 'next/cache';
import { resolveUserAccess } from '@/lib/access';
import { getRealUser } from '@/lib/auth';
import { assertNotDemoMode, isDemoMode } from '@/lib/demo/mode';
import { reportError } from '@/lib/monitoring/report-error';
import { attachmentMaxBytes, getFreePlanLimitMessage } from '@/lib/plans';
import { isUuid } from '@/lib/rag/validation';
import {
  ATTACHMENT_READ_URL_SECONDS,
  attachmentTooLargeMessage,
  isAttachmentMime,
  isEntryAttachmentKind,
  type EntryAttachmentKind,
} from '@/lib/service-book/attachments';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { ServiceAttachmentKind, ServiceAttachmentMime, Tables } from '@/types/supabase';
import type { ActionResult, Profile } from '@/types';

/**
 * Receipts, invoices and photos on a service book entry (20261014000400).
 *
 * The bucket is private and no rider policy reaches it, so the server is the
 * only way in and out: it mints a signed upload URL for a path the database
 * reserved, and a signed read URL once the rider's own select of the row says
 * the attachment is theirs. The service role is used for exactly those two
 * storage calls and for taking back an upload that failed - never to decide
 * whose an attachment is.
 *
 * An upload is three steps and the browser drives them: `reserveServiceAttachment`
 * (the allowance is counted under a per-book lock in SQL), the upload straight
 * to storage, then `confirmServiceAttachment`, which the database refuses until
 * the object is really there. Any step that fails calls
 * `discardServiceAttachment`, so a failed upload holds no slot and leaves no
 * object behind.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type Failure = { message: string; code?: string; details?: string | null; hint?: string | null };

const NOT_AUTHENTICATED = 'Not authenticated.';
const VEHICLE_NOT_FOUND = 'Vehicle not found.';
const ENTRY_NOT_FOUND = 'Entry not found.';
const ATTACHMENT_NOT_FOUND = 'That attachment could not be found.';
const READ_FAILED = 'The attachments could not be read. Try again.';
const UPLOAD_FAILED = 'The upload could not be saved. Try again.';
const NOT_ARRIVED = 'The upload did not finish. Try again.';
const WRONG_TYPE = 'Choose a photo or a PDF.';

function report(event: string, error: Failure, context: Record<string, unknown>) {
  reportError(event, new Error(error.message), { reason: error.code, details: error.details, hint: error.hint, ...context });
}

function entryPath(vehicleId: string, entryId: string): string {
  return `/garage/${vehicleId}/book/entries/${entryId}`;
}

/** The book of one of the rider's bikes, read as the rider so RLS decides. */
async function ownBookId(
  supabase: SupabaseServerClient,
  userId: string,
  vehicleId: string,
): Promise<{ ok: true; bookId: string } | { ok: false; error: string; failure?: Failure }> {
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id')
    .eq('id', vehicleId)
    .eq('user_id', userId)
    .maybeSingle();
  if (vehicleError) return { ok: false, error: READ_FAILED, failure: vehicleError };
  if (!vehicle) return { ok: false, error: VEHICLE_NOT_FOUND };
  const { data: book, error: bookError } = await supabase
    .from('service_books')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .maybeSingle();
  if (bookError) return { ok: false, error: READ_FAILED, failure: bookError };
  if (!book) return { ok: false, error: VEHICLE_NOT_FOUND };
  return { ok: true, bookId: book.id };
}

async function hasProAccess(supabase: SupabaseServerClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  return resolveUserAccess(data as Profile | null).hasProAccess;
}

export interface AttachmentUploadTarget {
  path: string;
  token: string;
}

export interface AttachmentReservation {
  attachmentId: string;
  /** The JPEG or PDF itself. */
  file: AttachmentUploadTarget;
  /** The 400px thumbnail beside a JPEG; null for a PDF. */
  thumb: AttachmentUploadTarget | null;
}

/** A refusal at the plan's allowance says so, so the form can show the notice. */
export type ReserveResult = ActionResult<AttachmentReservation> | { ok: false; error: string; atLimit: true };

/**
 * Holds a slot in the book's allowance and returns where to upload. The signed
 * upload URLs live two hours and name paths the database chose, so the browser
 * can write those two objects and nothing else.
 */
export async function reserveServiceAttachment(
  vehicleId: string,
  entryId: string,
  request: { kind: EntryAttachmentKind; mime: ServiceAttachmentMime; bytes: number },
): Promise<ReserveResult> {
  const demoError = await assertNotDemoMode<AttachmentReservation>();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };
  if (!isUuid(entryId)) return { ok: false, error: ENTRY_NOT_FOUND };
  if (!isEntryAttachmentKind(request?.kind)) return { ok: false, error: 'Choose what this file is.' };
  if (!isAttachmentMime(request.mime)) return { ok: false, error: WRONG_TYPE };
  if (!Number.isInteger(request.bytes) || request.bytes <= 0) return { ok: false, error: WRONG_TYPE };

  const supabase = await createClient();
  const book = await ownBookId(supabase, user.id, vehicleId);
  if (!book.ok) {
    if (book.failure) report('service-attachment-reserve', book.failure, { userId: user.id, vehicleId });
    return { ok: false, error: book.error };
  }

  const { data, error } = await supabase.rpc('reserve_service_attachment', {
    p_book_id: book.bookId,
    p_entry_id: entryId,
    p_kind: request.kind,
    p_mime: request.mime,
    p_bytes: request.bytes,
  });
  if (error) {
    if (error.code === 'TT402') return { ok: false, error: getFreePlanLimitMessage('attachments'), atLimit: true };
    if (error.code === 'TT413') {
      const pro = await hasProAccess(supabase, user.id);
      return { ok: false, error: attachmentTooLargeMessage(attachmentMaxBytes(pro), pro) };
    }
    if (error.code === 'TT404') return { ok: false, error: ENTRY_NOT_FOUND };
    report('service-attachment-reserve', error, { userId: user.id, vehicleId, entryId });
    return { ok: false, error: UPLOAD_FAILED };
  }

  const reserved = data as { id: string; object_path: string; thumb_path: string | null };
  const bucket = createAdminClient().storage.from('service-book');
  const [file, thumb] = await Promise.all([
    bucket.createSignedUploadUrl(reserved.object_path),
    reserved.thumb_path === null ? Promise.resolve(null) : bucket.createSignedUploadUrl(reserved.thumb_path),
  ]);
  const mintError = file.error ?? thumb?.error ?? null;
  if (mintError || !file.data) {
    report('service-attachment-reserve', mintError ?? { message: 'no signed upload URL' }, {
      userId: user.id,
      vehicleId,
      attachmentId: reserved.id,
    });
    await takeBack(user.id, reserved.id, [reserved.object_path, reserved.thumb_path]);
    return { ok: false, error: UPLOAD_FAILED };
  }

  return {
    ok: true,
    data: {
      attachmentId: reserved.id,
      file: { path: file.data.path, token: file.data.token },
      thumb: thumb?.data ? { path: thumb.data.path, token: thumb.data.token } : null,
    },
  };
}

/**
 * Marks an upload done. The database reads the object back from storage and
 * refuses one that is missing, of another type, or larger than the rider may
 * keep; any of those takes the reservation and the objects back, so the slot is
 * free again.
 */
export async function confirmServiceAttachment(vehicleId: string, attachmentId: string): Promise<ActionResult<void>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };
  if (!isUuid(attachmentId)) return { ok: false, error: ATTACHMENT_NOT_FOUND };

  const supabase = await createClient();
  const book = await ownBookId(supabase, user.id, vehicleId);
  if (!book.ok) return { ok: false, error: book.error };

  const { data, error } = await supabase.rpc('confirm_service_attachment', { p_attachment_id: attachmentId });
  if (error) {
    const refused = await discardServiceAttachment(vehicleId, attachmentId);
    if (!refused.ok && refused.error !== ATTACHMENT_NOT_FOUND) {
      report('service-attachment-confirm', { message: refused.error }, { userId: user.id, vehicleId, attachmentId });
    }
    if (error.code === 'TT413') {
      const pro = await hasProAccess(supabase, user.id);
      return { ok: false, error: attachmentTooLargeMessage(attachmentMaxBytes(pro), pro) };
    }
    if (error.code === 'TT404') return { ok: false, error: NOT_ARRIVED };
    if (error.code === '22023') return { ok: false, error: WRONG_TYPE };
    report('service-attachment-confirm', error, { userId: user.id, vehicleId, attachmentId });
    return { ok: false, error: UPLOAD_FAILED };
  }

  const confirmed = data as Pick<Tables<'service_attachments'>, 'entry_id'>;
  revalidatePath(`/garage/${vehicleId}/book`);
  if (confirmed.entry_id) revalidatePath(entryPath(vehicleId, confirmed.entry_id));
  return { ok: true, data: undefined };
}

/**
 * Takes back an upload that did not finish: its objects and its reservation.
 * Only a pending attachment the rider's own select can see is touched, so a
 * confirmed receipt is never removed this way.
 */
export async function discardServiceAttachment(vehicleId: string, attachmentId: string): Promise<ActionResult<void>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };
  if (!isUuid(attachmentId)) return { ok: false, error: ATTACHMENT_NOT_FOUND };

  const supabase = await createClient();
  const book = await ownBookId(supabase, user.id, vehicleId);
  if (!book.ok) return { ok: false, error: book.error };

  const { data: row, error } = await supabase
    .from('service_attachments')
    .select('id, object_path, thumb_path')
    .eq('id', attachmentId)
    .eq('book_id', book.bookId)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) {
    report('service-attachment-discard', error, { userId: user.id, vehicleId, attachmentId });
    return { ok: false, error: UPLOAD_FAILED };
  }
  if (!row) return { ok: false, error: ATTACHMENT_NOT_FOUND };

  return takeBack(user.id, row.id, [row.object_path, row.thumb_path]);
}

async function takeBack(userId: string, attachmentId: string, paths: (string | null)[]): Promise<ActionResult<void>> {
  const admin = createAdminClient();
  const objects = paths.filter((path): path is string => path !== null);
  const [removed, deleted] = await Promise.all([
    admin.storage.from('service-book').remove(objects),
    admin.from('service_attachments').delete().eq('id', attachmentId).eq('status', 'pending'),
  ]);
  const failure = removed.error ?? deleted.error;
  if (failure) {
    // The sweep deletes the reservation within a day whatever happens here.
    report('service-attachment-discard', failure, { userId, attachmentId });
    return { ok: false, error: UPLOAD_FAILED };
  }
  return { ok: true, data: undefined };
}

export interface ServiceAttachmentLink {
  id: string;
  kind: ServiceAttachmentKind;
  mime: ServiceAttachmentMime;
  bytes: number;
  uploaded_at: string;
  /** The file itself, signed for ten minutes. */
  url: string;
  /** The thumbnail, signed for ten minutes; null for a PDF. */
  thumbUrl: string | null;
}

/**
 * One entry's confirmed attachments with short-lived signed URLs. Which rows
 * come back is the rider's own select under RLS; only then does the service
 * role sign the paths those rows name. `vehicleId` is only for error reports.
 */
export async function getServiceAttachmentLinks(
  vehicleId: string,
  entryId: string,
): Promise<ActionResult<ServiceAttachmentLink[]>> {
  if (await isDemoMode()) return { ok: true, data: [] };

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };
  if (!isUuid(entryId)) return { ok: false, error: ENTRY_NOT_FOUND };

  // One read: RLS on service_attachments already admits only rows of the
  // rider's own books, so no vehicle or book lookup has to come first.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('service_attachments')
    .select('id, kind, mime, bytes, uploaded_at, object_path, thumb_path')
    .eq('entry_id', entryId)
    .eq('status', 'ready')
    .order('uploaded_at');
  if (error) {
    report('service-attachment-read', error, { userId: user.id, vehicleId, entryId });
    return { ok: false, error: READ_FAILED };
  }
  const rows = data ?? [];
  if (rows.length === 0) return { ok: true, data: [] };

  const paths = rows.flatMap((row) => (row.thumb_path ? [row.object_path, row.thumb_path] : [row.object_path]));
  const signed = await createAdminClient()
    .storage.from('service-book')
    .createSignedUrls(paths, ATTACHMENT_READ_URL_SECONDS);
  if (signed.error) {
    report('service-attachment-read', signed.error, { userId: user.id, vehicleId, entryId });
    return { ok: false, error: READ_FAILED };
  }
  const urlByPath = new Map(
    signed.data.filter((entry) => entry.path !== null && entry.error === null).map((entry) => [entry.path as string, entry.signedUrl]),
  );

  return {
    ok: true,
    data: rows.flatMap((row) => {
      const url = urlByPath.get(row.object_path);
      if (!url || row.uploaded_at === null) return [];
      return [
        {
          id: row.id,
          kind: row.kind,
          mime: row.mime,
          bytes: row.bytes,
          uploaded_at: row.uploaded_at,
          url,
          thumbUrl: row.thumb_path ? (urlByPath.get(row.thumb_path) ?? null) : null,
        },
      ];
    }),
  };
}
