import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { reportError } from '@/lib/monitoring/report-error';
import { ATTACHMENT_READ_URL_SECONDS } from '@/lib/service-book/attachments';
import type { ServiceEntryRecord } from '@/lib/service-book/book-data';
import type { ServiceBookField } from '@/lib/service-book/fields';
import type { SharedBookInput } from '@/lib/service-book/shared-view';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/types/supabase';

/**
 * A service book shared by link (owner, Q5): the token, the rate limit a link is
 * held to, and the reads the public page makes. Only this module and the share
 * page's routes reach a shared book, and they reach it with the service role
 * after `open_service_book_share` (20261016000500) has answered which book an
 * unrevoked link opens - so the token is the only access control, and what the
 * page prints is `buildSharedBookView`'s, never a row.
 */

/** 32 random bytes, as the link carries them: 43 base64url characters. */
export function createShareToken(): string {
  return randomBytes(32).toString('base64url');
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function isShareTokenShape(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_SHAPE.test(token);
}

/** What the database keeps of a token. Unsalted on purpose: 256 random bits need none. */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * How often one link may be used: the page and its attachment taps together.
 * Generous for a buyer reading the book, and a ceiling on the storage egress a
 * leaked link can spend.
 */
export const SHARE_VIEW_LIMIT = 120;
export const SHARE_VIEW_WINDOW_SECONDS = 60 * 60;

export type ShareOpening =
  | { kind: 'open'; bookId: string }
  | { kind: 'not_found' }
  | { kind: 'rate_limited' }
  | { kind: 'failed' };

/**
 * Which book a link opens. `countView` is true for the page and false for a tap
 * on one of its attachments; both spend the link's rate limit. A token of the
 * wrong shape is not looked up.
 */
export async function openShare(token: string, options: { countView: boolean }): Promise<ShareOpening> {
  if (!isShareTokenShape(token)) return { kind: 'not_found' };
  const { data, error } = await createAdminClient().rpc('open_service_book_share', {
    p_token_hash: hashShareToken(token),
    p_count_view: options.countView,
    p_limit: SHARE_VIEW_LIMIT,
    p_window_seconds: SHARE_VIEW_WINDOW_SECONDS,
  });
  if (error) {
    reportError('service-book-share-open', new Error(error.message), { reason: error.code });
    return { kind: 'failed' };
  }
  const row = data?.[0];
  if (!row) return { kind: 'not_found' };
  if (row.rate_limited) return { kind: 'rate_limited' };
  return row.book_id ? { kind: 'open', bookId: row.book_id } : { kind: 'not_found' };
}

/**
 * How many full PDFs one link may make a day. A full file reads every photo in
 * the book from storage - up to 150 of them - so it costs far more egress than a
 * page view, and the hourly view limit alone would let a leaked link pull
 * gigabytes a day. A summary is held only to the view limit.
 */
export const SHARE_FULL_PDF_LIMIT = 10;
export const SHARE_FULL_PDF_WINDOW_SECONDS = 24 * 60 * 60;

/** Spends one of the link's full PDFs for the day: `limited` once they are gone. */
export async function consumeFullPdfAllowance(token: string): Promise<'ok' | 'limited' | 'failed'> {
  const { data, error } = await createAdminClient().rpc('consume_beta_rate_limit', {
    p_key_hash: `service-book-share-pdf:${hashShareToken(token)}`,
    p_limit: SHARE_FULL_PDF_LIMIT,
    p_window_seconds: SHARE_FULL_PDF_WINDOW_SECONDS,
  });
  if (error) {
    reportError('service-book-share-pdf', new Error(error.message), { reason: error.code });
    return 'failed';
  }
  return data ? 'limited' : 'ok';
}

type Failure = { message: string; code?: string };

const PAGE_SIZE = 1000;

async function readAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: Failure | null }>,
): Promise<{ data: T[]; error: Failure | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: [], error };
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return { data: rows, error: null };
  }
}

export interface SharedBookRows {
  input: SharedBookInput;
  /** Each confirmed attachment's thumbnail, signed for ten minutes; absent for a PDF, and empty unless asked for. */
  thumbUrlByAttachmentId: Map<string, string>;
  /** Each confirmed attachment of a live entry's stored object, for the server alone to read: a PDF export embeds the photos. */
  objectPathByAttachmentId: Map<string, string>;
}

/**
 * Every row a shared page prints, read with the service role for the one book a
 * link opened. Columns are named rather than `*` so nothing that identifies the
 * owner - `vehicles.user_id`, `logged_by`, `created_by`, the vehicle photo, whose
 * path is the owner's id - is read at all. A failed read is `null`, never a
 * shorter book: a history that silently loses rows is what the share exists to
 * rule out.
 */
export async function loadSharedBook(bookId: string, options: { signThumbs: boolean } = { signThumbs: true }): Promise<SharedBookRows | null> {
  const admin = createAdminClient();
  const fail = (table: string, error: Failure) => {
    reportError('service-book-share-read', new Error(error.message), { reason: error.code, table, bookId });
    return null;
  };

  const bookRead = await admin
    .from('service_books')
    .select('id, vehicle_id, distance_unit, owner_time_zone')
    .eq('id', bookId)
    .maybeSingle();
  if (bookRead.error) return fail('service_books', bookRead.error);
  if (!bookRead.data) return null;
  const book = bookRead.data;

  const [vehicle, fields, items, entries, entryItems, entryParts, revisions, readings, attachments] = await Promise.all([
    admin.from('vehicles').select('nickname, type, year, make, model').eq('id', book.vehicle_id).maybeSingle(),
    admin.from('service_book_fields').select('id, builtin_key, label, field_type, options, enabled, required, sort_order').eq('book_id', bookId).order('sort_order'),
    admin.from('service_items').select('*').eq('book_id', bookId).order('sort_order'),
    readAllRows((from, to) =>
      admin
        .from('service_entries')
        .select('id, book_id, service_date, reading_hours, reading_distance, performed_by, shop_name, cost_cents, currency, notes, custom_fields, origin, logged_at, revision, deleted_at')
        .eq('book_id', bookId)
        .order('id')
        .range(from, to),
    ),
    readAllRows((from, to) =>
      admin
        .from('service_entry_items')
        .select('id, entry_id, item_id, label, created_at, service_entries!inner()')
        .eq('service_entries.book_id', bookId)
        .order('created_at')
        .order('id')
        .range(from, to),
    ),
    readAllRows((from, to) =>
      admin
        .from('service_entry_parts')
        .select('id, entry_id, entry_item_id, brand, part_number, quantity, unit_cost_cents, created_at, service_entries!inner()')
        .eq('service_entries.book_id', bookId)
        .order('created_at')
        .order('id')
        .range(from, to),
    ),
    readAllRows((from, to) =>
      admin
        .from('service_entry_revisions')
        .select('entry_id, revision, kind, changed_at, service_entries!inner()')
        .eq('service_entries.book_id', bookId)
        .order('revision')
        .order('id')
        .range(from, to),
    ),
    readAllRows((from, to) =>
      admin
        .from('vehicle_readings')
        .select('id, reading_date, read_at, hours, distance, supersedes_id')
        .eq('book_id', bookId)
        .order('reading_date')
        .order('id')
        .range(from, to),
    ),
    readAllRows((from, to) =>
      admin
        .from('service_attachments')
        .select('id, entry_id, kind, mime, bytes, uploaded_at, created_at, thumb_path, object_path')
        .eq('book_id', bookId)
        .eq('status', 'ready')
        .order('uploaded_at')
        .order('id')
        .range(from, to),
    ),
  ]);
  for (const [table, result] of [
    ['vehicles', vehicle],
    ['service_book_fields', fields],
    ['service_items', items],
    ['service_entries', entries],
    ['service_entry_items', entryItems],
    ['service_entry_parts', entryParts],
    ['service_entry_revisions', revisions],
    ['vehicle_readings', readings],
    ['service_attachments', attachments],
  ] as const) {
    if (result.error) return fail(table, result.error);
  }
  if (!vehicle.data) return null;

  const entryRows = entries.data as unknown as Omit<ServiceEntryRecord, 'items' | 'parts' | 'revisions' | 'attachments'>[];
  const liveEntryIds = new Set(entryRows.filter((entry) => entry.deleted_at === null).map((entry) => entry.id));
  // A removed entry's attachments are part of its content, so none is signed.
  const attachmentRows = attachments.data.filter(
    (attachment) => attachment.entry_id !== null && liveEntryIds.has(attachment.entry_id) && attachment.uploaded_at !== null,
  );

  const thumbUrlByAttachmentId = new Map<string, string>();
  const objectPathByAttachmentId = new Map(attachmentRows.map((attachment) => [attachment.id, attachment.object_path]));
  const thumbPaths = options.signThumbs ? attachmentRows.flatMap((attachment) => (attachment.thumb_path ? [attachment.thumb_path] : [])) : [];
  if (thumbPaths.length > 0) {
    const signed = await admin.storage.from('service-book').createSignedUrls(thumbPaths, ATTACHMENT_READ_URL_SECONDS);
    if (signed.error) return fail('storage.objects', signed.error);
    const urlByPath = new Map<string, string>();
    for (const entry of signed.data) {
      if (entry.path !== null && entry.error === null) urlByPath.set(entry.path, entry.signedUrl);
    }
    for (const attachment of attachmentRows) {
      const url = attachment.thumb_path ? urlByPath.get(attachment.thumb_path) : undefined;
      if (url) thumbUrlByAttachmentId.set(attachment.id, url);
    }
  }

  const records = entryRows.map((entry) => {
    const live = liveEntryIds.has(entry.id);
    return {
      ...entry,
      items: live ? entryItems.data.filter((item) => item.entry_id === entry.id).map(({ id, entry_id, item_id, label, created_at }) => ({ id, entry_id, item_id, label, created_at })) : [],
      parts: live
        ? entryParts.data
            .filter((part) => part.entry_id === entry.id)
            .map(({ id, entry_id, entry_item_id, brand, part_number, quantity, unit_cost_cents, created_at }) => ({
              id,
              entry_id,
              entry_item_id,
              brand,
              part_number,
              quantity,
              unit_cost_cents,
              created_at,
            }))
        : [],
      revisions: live
        ? revisions.data.filter((revision) => revision.entry_id === entry.id).map(({ revision, kind, changed_at }) => ({ revision, kind, changed_at }))
        : [],
      attachments: attachmentRows
        .filter((attachment) => attachment.entry_id === entry.id)
        .map(({ id, entry_id, kind, mime, bytes, uploaded_at, created_at }) => ({ id, entry_id, kind, mime, bytes, uploaded_at, created_at })),
    };
  }) as unknown as ServiceEntryRecord[];

  return {
    input: {
      vehicle: vehicle.data as Pick<Tables<'vehicles'>, 'nickname' | 'type' | 'year' | 'make' | 'model'>,
      book: { distance_unit: book.distance_unit, owner_time_zone: book.owner_time_zone },
      fields: (fields.data ?? []) as ServiceBookField[],
      items: (items.data ?? []) as Tables<'service_items'>[],
      entries: records,
      readings: readings.data as SharedBookInput['readings'],
    },
    thumbUrlByAttachmentId,
    objectPathByAttachmentId,
  };
}

/**
 * The object path of one confirmed attachment of a live entry in this book, or
 * null: the one file a tap on the shared page may open.
 */
export async function sharedAttachmentPath(bookId: string, attachmentId: string): Promise<{ path: string | null } | { failed: true }> {
  const { data, error } = await createAdminClient()
    .from('service_attachments')
    .select('object_path, service_entries!inner(deleted_at)')
    .eq('id', attachmentId)
    .eq('book_id', bookId)
    .eq('status', 'ready')
    .is('service_entries.deleted_at', null)
    .maybeSingle();
  if (error) {
    reportError('service-book-share-read', new Error(error.message), { reason: error.code, table: 'service_attachments', bookId, attachmentId });
    return { failed: true };
  }
  return { path: data?.object_path ?? null };
}
