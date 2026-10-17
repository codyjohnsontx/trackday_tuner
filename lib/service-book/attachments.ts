import type { ServiceAttachmentKind, ServiceAttachmentMime, Tables } from '@/types/supabase';

/**
 * The rules an attachment upload follows on the rider's device and on the
 * server: which kinds an entry takes, what a chosen file becomes before it is
 * uploaded, and how the book's allowance is counted. The database enforces the
 * count and the size (reserve_service_attachment and confirm_service_attachment,
 * 20261014000400); these are the same rules said early, so a rider is told
 * before anything is uploaded.
 *
 * Pure: no Supabase, no Next, no DOM, so the phone app can upload the same way.
 */

/** The kinds a rider attaches to an entry, in the order the form offers them. */
export const ENTRY_ATTACHMENT_KINDS = ['receipt', 'invoice', 'photo'] as const;
export type EntryAttachmentKind = (typeof ENTRY_ATTACHMENT_KINDS)[number];

export const ATTACHMENT_KIND_LABELS: Record<ServiceAttachmentKind, string> = {
  receipt: 'Receipt',
  invoice: 'Invoice',
  photo: 'Photo',
  manual_page: 'Manual page',
  book_page: 'Service book page',
};

export function isEntryAttachmentKind(value: unknown): value is EntryAttachmentKind {
  return typeof value === 'string' && (ENTRY_ATTACHMENT_KINDS as readonly string[]).includes(value);
}

export const ATTACHMENT_MIMES: readonly ServiceAttachmentMime[] = ['image/jpeg', 'application/pdf'];

export function isAttachmentMime(value: unknown): value is ServiceAttachmentMime {
  return typeof value === 'string' && (ATTACHMENT_MIMES as readonly string[]).includes(value);
}

/**
 * A reservation nobody confirms stops counting after a day, and the daily sweep
 * deletes it. The same interval as `interval '1 day'` in the migration.
 */
export const ATTACHMENT_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

/** How long a signed URL to read an attachment lives. */
export const ATTACHMENT_READ_URL_SECONDS = 10 * 60;

/** A photo is stored at most this many pixels on its long edge, as a JPEG. */
export const ATTACHMENT_IMAGE_LONG_EDGE = 2048;
/** The thumbnail beside it, which every list reads instead of the photo. */
export const ATTACHMENT_THUMB_LONG_EDGE = 400;
export const ATTACHMENT_JPEG_QUALITY = 0.82;

/**
 * The most a thumbnail may weigh. A 400px JPEG is around 30 KB;
 * confirm_service_attachment refuses one over this, or of any other type.
 */
export const ATTACHMENT_THUMB_MAX_BYTES = 1024 * 1024;

/**
 * The size an image is drawn at: its own size when it already fits, otherwise
 * scaled so the long edge is `longEdge`, keeping its shape. Never upscaled.
 */
export function fitWithin(width: number, height: number, longEdge: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) throw new Error('an image has a size');
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * What the browser does with a file the rider chose: an image is decoded and
 * re-encoded as a JPEG (which also drops its EXIF, location included), a PDF is
 * uploaded as it is, and anything else is refused before any upload.
 */
export type AttachmentSource = { kind: 'image' } | { kind: 'pdf' } | { kind: 'refused'; reason: string };

export function classifyAttachmentFile(file: { type: string; name: string }): AttachmentSource {
  const type = file.type.toLowerCase();
  if (type === 'application/pdf' || (type === '' && /\.pdf$/i.test(file.name))) return { kind: 'pdf' };
  if (type.startsWith('image/')) return { kind: 'image' };
  return { kind: 'refused', reason: 'Choose a photo or a PDF.' };
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The refusal a rider reads for a file larger than their plan keeps. */
export function attachmentTooLargeMessage(maxBytes: number, hasProAccess: boolean): string {
  const limit = `${Math.round(maxBytes / (1024 * 1024))} MB`;
  return hasProAccess
    ? `That file is larger than ${limit}, the most one attachment can be.`
    : `That file is larger than ${limit}, the most one attachment can be on the free plan.`;
}

/**
 * The count the allowance is held to: every confirmed attachment, and every
 * reservation younger than a day, so an upload in flight holds its slot. A
 * receipt that came with a bike handed over by its previous owner is not one
 * the rider added, and counts toward nothing (owner, TQ1) - the rule
 * reserve_service_attachment enforces.
 */
export function countTowardAllowance(
  rows: readonly Pick<Tables<'service_attachments'>, 'status' | 'created_at' | 'copied_from_attachment_id'>[],
  now: Date,
): number {
  const cutoff = now.getTime() - ATTACHMENT_RESERVATION_TTL_MS;
  return rows.filter(
    (row) => row.copied_from_attachment_id === null && (row.status === 'ready' || Date.parse(row.created_at) > cutoff),
  ).length;
}
