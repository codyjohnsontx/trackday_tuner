'use server';

import { revalidatePath } from 'next/cache';
import { getRealUser } from '@/lib/auth';
import { assertNotDemoMode, isDemoMode } from '@/lib/demo/mode';
import { reportError } from '@/lib/monitoring/report-error';
import { isUuid } from '@/lib/rag/validation';
import { createShareToken, hashShareToken } from '@/lib/service-book-share';
import {
  HANDOVER_LINK_DAYS,
  isHandoverEmailShape,
  normalizeHandoverEmail,
  type HandoverExtraCounts,
  type ServiceBookHandoverRow,
} from '@/lib/service-book/handover';
import { isKnownTimeZone } from '@/lib/service-book/provenance';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/types';

/**
 * The seller's side of handing a bike to a buyer (owner, PQ2; TQ3, TQ4, TQ6):
 * making the link, reading the one pending handover a book may have, and
 * withdrawing it. Every write is a call to a function of 20261017000600 as the
 * rider - `create_service_book_transfer` and `cancel_service_book_transfer` -
 * because no rider holds insert or update on `service_book_transfers`; the
 * database decides one pending link per book, refuses a sold bike and the
 * seller's own address, and dates the cancel. The link's token is made and
 * hashed here exactly as a share link's is (`lib/service-book-share.ts`):
 * only the SHA-256 is stored, so the link is shown once. The buyer's side -
 * the `/transfer/[token]` page, prepare and accept - lives elsewhere.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type Failure = { message: string; code?: string; details?: string | null; hint?: string | null };

const NOT_AUTHENTICATED = 'Not authenticated.';
const BOOK_NOT_FOUND = 'This bike has no service book yet.';
const HANDOVER_NOT_FOUND = 'That handover link could not be found. It may already have been cancelled or accepted.';
const READ_FAILED = 'The handover could not be read. Try again.';
const WRITE_FAILED = 'The handover link could not be made. Try again.';
const CANCEL_FAILED = 'The handover link could not be cancelled. Try again.';
const EMAIL_INVALID = "Enter the buyer's email address.";
const EMAIL_OWN = 'A bike cannot be handed over to the account selling it.';
const READING_INVALID = 'A reading at handover has to be a number of zero or more.';
const ALREADY_SOLD = 'This bike was handed over already.';
const ALREADY_PENDING = 'This bike already has a handover link. Cancel it to send a new one.';

/** What `create_service_book_transfer` answers with, and the sentence a seller reads for each. */
const CREATE_REFUSALS: Record<string, string> = {
  TT404: BOOK_NOT_FOUND,
  TT409: ALREADY_PENDING,
  TT410: ALREADY_SOLD,
};

/** The columns a rider may select (20261017000600): never the token's hash. */
const HANDOVER_COLUMNS = 'id, book_id, to_email_normalized, status, expires_at, handover_hours, handover_distance, created_at';

/** The shape the column's check holds `seller_time_zone` to. */
const TIME_ZONE_SHAPE = /^[A-Za-z0-9_+/-]{1,64}$/;

function report(event: string, error: Failure, context: Record<string, unknown>) {
  reportError(event, new Error(error.message), { reason: error.code, details: error.details, hint: error.hint, ...context });
}

function storableTimeZone(timeZone: unknown): string | null {
  return typeof timeZone === 'string' && TIME_ZONE_SHAPE.test(timeZone) && isKnownTimeZone(timeZone) ? timeZone : null;
}

async function ownBook(
  supabase: SupabaseServerClient,
  vehicleId: string,
): Promise<{ ok: true; book: { id: string; vehicle_id: string } | null } | { ok: false; error: Failure }> {
  if (!isUuid(vehicleId)) return { ok: true, book: null };
  // RLS admits only a book on one of the rider's own bikes.
  const { data, error } = await supabase.from('service_books').select('id, vehicle_id').eq('vehicle_id', vehicleId).maybeSingle();
  if (error) return { ok: false, error };
  return { ok: true, book: data ?? null };
}

function revalidateHandover(vehicleId: string) {
  revalidatePath(`/garage/${vehicleId}/book`);
  revalidatePath(`/garage/${vehicleId}/book/handover`);
  revalidatePath('/garage');
}

async function readPending(supabase: SupabaseServerClient, bookId: string): Promise<{ data: ServiceBookHandoverRow | null; error: Failure | null }> {
  // One pending row per book is a unique index, so this is at most one row.
  const { data, error } = await supabase.from('service_book_transfers').select(HANDOVER_COLUMNS).eq('book_id', bookId).eq('status', 'pending').maybeSingle();
  return { data: (data as ServiceBookHandoverRow | null) ?? null, error };
}

/** The book's one pending handover link, expired or not, or `null` when none is out. */
export async function getServiceBookHandover(vehicleId: string): Promise<ActionResult<ServiceBookHandoverRow | null>> {
  if (await isDemoMode()) return { ok: true, data: null };

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };

  const supabase = await createClient();
  const bookRead = await ownBook(supabase, vehicleId);
  if (!bookRead.ok) {
    report('service-book-handover-read', bookRead.error, { table: 'service_books', userId: user.id, vehicleId });
    return { ok: false, error: READ_FAILED };
  }
  if (!bookRead.book) return { ok: true, data: null };

  const pending = await readPending(supabase, bookRead.book.id);
  if (pending.error) {
    report('service-book-handover-read', pending.error, { table: 'service_book_transfers', userId: user.id, vehicleId });
    return { ok: false, error: READ_FAILED };
  }
  return { ok: true, data: pending.data };
}

/**
 * The pending handover of each of these bikes, keyed by vehicle id, for the
 * garage cards. A failed read is reported and leaves every card without the
 * line, since nothing here decides a write.
 */
export async function getPendingHandovers(vehicleIds: string[]): Promise<Record<string, ServiceBookHandoverRow>> {
  const ids = Array.isArray(vehicleIds) ? vehicleIds.filter((id): id is string => typeof id === 'string' && isUuid(id)) : [];
  if (ids.length === 0 || (await isDemoMode())) return {};

  const user = await getRealUser();
  if (!user) return {};

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('service_book_transfers')
    .select(`${HANDOVER_COLUMNS}, service_books!inner(vehicle_id)`)
    .in('service_books.vehicle_id', ids)
    .eq('status', 'pending');
  if (error) {
    report('service-book-handover-read', error, { table: 'service_book_transfers', userId: user.id, vehicleIds: ids });
    return {};
  }

  const result: Record<string, ServiceBookHandoverRow> = {};
  for (const row of data ?? []) {
    // The embedded parent is typed by the generated client from the select
    // string, which it cannot read through `!inner(...)`; the shape is the one
    // the string asks for.
    const { service_books, ...handover } = row as unknown as ServiceBookHandoverRow & { service_books: { vehicle_id: string } };
    result[service_books.vehicle_id] = handover;
  }
  return result;
}

/**
 * The three counts the handover screen shows that the book's own read does not
 * carry: the bike's session photos, its outcome notes, and the entries this
 * owner removed. Everything else the screen says is counted off the book read
 * beside it (`countHandover`).
 */
export async function getServiceBookHandoverCounts(vehicleId: string): Promise<ActionResult<HandoverExtraCounts>> {
  if (await isDemoMode()) return { ok: true, data: { sessionPhotos: 0, outcomes: 0, removedEntries: 0 } };

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };

  const supabase = await createClient();
  const bookRead = await ownBook(supabase, vehicleId);
  if (!bookRead.ok) {
    report('service-book-handover-read', bookRead.error, { table: 'service_books', userId: user.id, vehicleId });
    return { ok: false, error: READ_FAILED };
  }
  if (!bookRead.book) return { ok: false, error: BOOK_NOT_FOUND };

  const [photos, outcomes, removed] = await Promise.all([
    supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('vehicle_id', vehicleId).not('photo_url', 'is', null),
    supabase.from('session_feedback').select('id', { count: 'exact', head: true }).eq('vehicle_id', vehicleId),
    supabase.from('service_entries').select('id', { count: 'exact', head: true }).eq('book_id', bookRead.book.id).not('deleted_at', 'is', null),
  ]);
  for (const [table, result] of [
    ['sessions', photos],
    ['session_feedback', outcomes],
    ['service_entries', removed],
  ] as const) {
    if (result.error) {
      report('service-book-handover-read', result.error, { table, userId: user.id, vehicleId });
      return { ok: false, error: READ_FAILED };
    }
  }
  return { ok: true, data: { sessionPhotos: photos.count ?? 0, outcomes: outcomes.count ?? 0, removedEntries: removed.count ?? 0 } };
}

export interface CreateHandoverInput {
  email: string;
  /** The reading at handover, optional; `null` when the seller left it blank. */
  hours: number | null;
  distance: number | null;
  /** The seller's browser zone, the fallback for labels on entries that predate a stored one. */
  timeZone: string;
}

function readingOf(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? { ok: true, value } : { ok: false };
}

/**
 * Makes the handover link and returns its token, which is stored nowhere and so
 * is returned only this once. The database refuses a second pending link, a
 * sold bike and the seller's own address; those are checked here first only so
 * the sentence the seller reads is this module's rather than SQL's.
 */
export async function createServiceBookHandover(
  vehicleId: string,
  input: CreateHandoverInput,
): Promise<ActionResult<{ token: string; handover: ServiceBookHandoverRow }>> {
  const demoError = await assertNotDemoMode<{ token: string; handover: ServiceBookHandoverRow }>();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };

  const email = typeof input?.email === 'string' ? normalizeHandoverEmail(input.email) : '';
  if (!isHandoverEmailShape(email)) return { ok: false, error: EMAIL_INVALID };
  if (user.email && email === normalizeHandoverEmail(user.email)) return { ok: false, error: EMAIL_OWN };
  const hours = readingOf(input?.hours);
  const distance = readingOf(input?.distance);
  if (!hours.ok || !distance.ok) return { ok: false, error: READING_INVALID };

  const supabase = await createClient();
  const bookRead = await ownBook(supabase, vehicleId);
  if (!bookRead.ok) {
    report('service-book-handover-create', bookRead.error, { table: 'service_books', userId: user.id, vehicleId });
    return { ok: false, error: WRITE_FAILED };
  }
  if (!bookRead.book) return { ok: false, error: BOOK_NOT_FOUND };

  const token = createShareToken();
  const { data: handoverId, error } = await supabase.rpc('create_service_book_transfer', {
    p_book_id: bookRead.book.id,
    p_to_email: email,
    p_token_hash: hashShareToken(token),
    p_handover_hours: hours.value,
    p_handover_distance: distance.value,
    p_time_zone: storableTimeZone(input?.timeZone),
  });
  if (error) {
    const refusal = error.code ? CREATE_REFUSALS[error.code] : undefined;
    if (refusal) return { ok: false, error: refusal };
    report('service-book-handover-create', error, { table: 'service_book_transfers', userId: user.id, vehicleId });
    return { ok: false, error: WRITE_FAILED };
  }
  if (typeof handoverId !== 'string') {
    report('service-book-handover-create', { message: 'create_service_book_transfer returned no id' }, { userId: user.id, vehicleId });
    return { ok: false, error: WRITE_FAILED };
  }

  const { data: handover, error: readError } = await supabase.from('service_book_transfers').select(HANDOVER_COLUMNS).eq('id', handoverId).single();
  if (readError || !handover) {
    // The link exists and the token is in hand; losing the row's dates would
    // lose the link itself, so the seller gets it with the expiry the database
    // defaults to rather than being told it failed.
    report('service-book-handover-create', readError ?? { message: 'handover row not readable after create' }, { userId: user.id, vehicleId, handoverId });
  }
  revalidateHandover(vehicleId);
  return {
    ok: true,
    data: {
      token,
      handover:
        (handover as ServiceBookHandoverRow | null) ??
        {
          id: handoverId,
          book_id: bookRead.book.id,
          to_email_normalized: email,
          status: 'pending',
          expires_at: new Date(Date.now() + HANDOVER_LINK_DAYS * 24 * 60 * 60 * 1000).toISOString(),
          handover_hours: hours.value,
          handover_distance: distance.value,
          created_at: new Date().toISOString(),
        },
    },
  };
}

/** Withdraws the book's pending link, expired or not, so a new one can be made (TQ4). */
export async function cancelServiceBookHandover(vehicleId: string, handoverId: string): Promise<ActionResult<void>> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };
  if (!isUuid(handoverId)) return { ok: false, error: HANDOVER_NOT_FOUND };

  const supabase = await createClient();
  const bookRead = await ownBook(supabase, vehicleId);
  if (!bookRead.ok) {
    report('service-book-handover-cancel', bookRead.error, { table: 'service_books', userId: user.id, vehicleId });
    return { ok: false, error: CANCEL_FAILED };
  }
  if (!bookRead.book) return { ok: false, error: BOOK_NOT_FOUND };

  const { data: cancelled, error } = await supabase.rpc('cancel_service_book_transfer', { p_transfer_id: handoverId });
  if (error) {
    report('service-book-handover-cancel', error, { table: 'service_book_transfers', userId: user.id, vehicleId, handoverId });
    return { ok: false, error: CANCEL_FAILED };
  }
  if (cancelled !== true) return { ok: false, error: HANDOVER_NOT_FOUND };

  revalidateHandover(vehicleId);
  return { ok: true, data: undefined };
}
